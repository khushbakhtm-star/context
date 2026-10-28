package expo.modules.contextwear

import android.content.Context
import android.net.Uri
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataItem
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.text.ParsePosition
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/** Data Layer is scoped by Play Services to the matching package AND signing certificate. */
internal object WearBridge {
  private const val APPLICATION_ID = "com.context.minuteledger"
  private const val WATCH_PREFIX = "/context/v1/watch/"
  private const val PHONE_PREFIX = "/context/v1/phone/"
  private const val REQUEST_LIMIT = 2 * 1024
  private const val EDIT_LIMIT = 256 * 1024
  private const val DAY_LIMIT = 8 * 1024 * 1024
  private const val ACK_LIMIT = 256 * 1024
  private val uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
  private val watchPath = Regex("^/context/v1/watch/(request|edit)/($uuid)$")
  private val uuidValue = Regex("^$uuid$")
  private val dateValue = Regex("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")
  private val transport = ReentrantLock()
  private val scan = ReentrantLock()
  private val sentAtLock = Any()
  private val consentLock = Any()
  private var consentEpoch = 0L
  private val admission = Any()
  private val admitted = HashSet<String>()
  private val scanScheduled = AtomicBoolean(false)
  private val withdrawalScheduled = AtomicBoolean(false)
  private val disabledWithdrawn = AtomicBoolean(false)
  private val workers = WearWorkLanes()
  private val publications = WearPublicationLanes()
  // Enumeration may wait on old Assets. A fresh DataEvent has bounded admission
  // and its own receiver so a nearby Bluetooth edit does not wait behind it.
  private val observers = ConcurrentHashMap<String, (Int) -> Unit>()
  @Volatile private var lastError: String? = null
  private var lastSentAt = 0L

  private data class Incoming(val uri: Uri, val path: String, val asset: Asset, val digest: String, val limit: Int)

  fun addObserver(id: String, observer: (Int) -> Unit) { observers[id] = observer }
  fun removeObserver(id: String) { observers.remove(id) }

  private fun changed(context: Context) {
    val count = WearInbox.count(context)
    observers.values.forEach { observer -> try { observer(count) } catch (_: Exception) { } }
  }

  private fun error(error: Throwable) {
    lastError = if (error is WearBridgeFailure) error.code else "ERR_WEAR_UNAVAILABLE"
  }

  private fun requireIdentity(context: Context) {
    if (context.packageName != APPLICATION_ID) throw WearBridgeFailure("ERR_WEAR_APP_IDENTITY")
  }

  private fun requireEnabled(context: Context) {
    requireIdentity(context)
    if (!WearInbox.enabled(context)) throw WearBridgeFailure("ERR_WEAR_DISABLED")
  }

  private fun requireAvailable(context: Context) {
    requireIdentity(context)
    if (GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context) != ConnectionResult.SUCCESS) {
      throw WearBridgeFailure("ERR_WEAR_PLAY_SERVICES_UNAVAILABLE")
    }
  }

  private fun <T> waitFor(task: Task<T>): T = Tasks.await(task, 30, TimeUnit.SECONDS)

  fun setEnabled(context: Context, enabled: Boolean) {
    requireIdentity(context)
    // Revocation is durable immediately, even while an earlier SDK call completes.
    synchronized(consentLock) {
      consentEpoch++
      WearInbox.setEnabled(context, enabled)
    }
    disabledWithdrawn.set(false)
    lastError = null
    if (enabled) scheduleScan(context.applicationContext)
    else scheduleWithdrawal(context.applicationContext)
    changed(context)
  }

  private fun scheduleWithdrawal(context: Context) {
    if (disabledWithdrawn.get() || !withdrawalScheduled.compareAndSet(false, true)) return
    workers.maintain {
      try {
        publications.withdrawAll {
          if (!WearInbox.enabled(context)) {
            requireAvailable(context)
            val local = waitFor(Wearable.getNodeClient(context).localNode)
            val uri = Uri.Builder().scheme("wear").authority(local.id).path(PHONE_PREFIX).build()
            waitFor(Wearable.getDataClient(context).deleteDataItems(uri, DataClient.FILTER_PREFIX))
            disabledWithdrawn.set(true)
          }
        }
      } catch (failure: Throwable) { error(failure) }
      finally { withdrawalScheduled.set(false) }
    }
  }

  private fun incoming(context: Context, item: DataItem): Incoming? {
    requireIdentity(context)
    if (!WearInbox.enabled(context)) return null
    val uri = item.uri
    val path = uri.path ?: return null
    val match = watchPath.matchEntire(path) ?: return null
    if (uri.scheme != "wear" || uri.host.isNullOrBlank() || uri.host == "*" ||
      uri.query != null || uri.fragment != null) return null
    val map = DataMapItem.fromDataItem(item).dataMap
    if (map.getInt("protocolVersion") != 1) throw WearBridgeFailure("ERR_WEAR_PROTOCOL")
    val asset = map.getAsset("payload") ?: throw WearBridgeFailure("ERR_WEAR_INVALID_ASSET")
    val digest = asset.digest ?: throw WearBridgeFailure("ERR_WEAR_INVALID_ASSET")
    // The SDK digest is opaque (not a path or filename); do not assume a hash encoding.
    if (digest.length !in 1..512 || digest.any { it.isISOControl() }) throw WearBridgeFailure("ERR_WEAR_INVALID_ASSET")
    return Incoming(Uri.parse(uri.toString()), path, asset, digest,
      if (match.groupValues[1] == "request") REQUEST_LIMIT else EDIT_LIMIT)
  }

  /** Called on the listener's background thread; only Asset metadata escapes its DataEventBuffer. */
  fun enqueue(context: Context, item: DataItem) {
    val application = context.applicationContext
    if (!WearInbox.enabled(application)) { scheduleWithdrawal(application); return }
    val envelope = try { incoming(application, item) } catch (failure: Throwable) { error(failure); null } ?: return
    val key = envelope.uri.toString() + "\n" + envelope.digest
    synchronized(admission) {
      if (admitted.contains(key)) return
      if (admitted.size >= WearInbox.MAX_RECORDS) { lastError = "ERR_WEAR_BACKPRESSURE"; return }
      admitted.add(key)
    }
    workers.receive {
      try { receive(application, envelope) }
      catch (failure: Throwable) { error(failure) }
      finally { synchronized(admission) { admitted.remove(key) } }
    }
  }

  fun scanPending(context: Context) = scan.withLock {
    requireEnabled(context)
    requireAvailable(context)
    val uri = Uri.parse("wear://*$WATCH_PREFIX")
    val items = waitFor(Wearable.getDataClient(context).getDataItems(uri, DataClient.FILTER_PREFIX))
    try {
      var visited = 0
      for (item in items) {
        if (!WearInbox.enabled(context)) break
        if (++visited > 4096) { lastError = "ERR_WEAR_BACKPRESSURE"; break }
        try {
          val envelope = incoming(context, item) ?: continue
          receive(context, envelope)
        } catch (failure: Throwable) {
          error(failure)
          if (failure is WearBridgeFailure && failure.code == "ERR_WEAR_INBOX_FULL") break
        }
      }
    } finally { items.release() }
    // receive() notifies only after a new durable record. An unchanged scan must
    // not emit a hint: JavaScript responds to hints by draining and scanning again.
  }

  private fun receive(context: Context, envelope: Incoming) {
    requireEnabled(context)
    if (WearInbox.containsAsset(context, envelope.uri.toString(), envelope.digest)) return
    if (WearInbox.count(context) >= WearInbox.MAX_RECORDS) throw WearBridgeFailure("ERR_WEAR_INBOX_FULL")
    requireAvailable(context)
    val response = waitFor(Wearable.getDataClient(context).getFdForAsset(envelope.asset))
    val bytes = try {
      val input = response.inputStream ?: throw WearBridgeFailure("ERR_WEAR_INVALID_ASSET")
      input.use { stream ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(8192)
        while (true) {
          requireEnabled(context)
          val size = stream.read(buffer)
          if (size < 0) break
          if (output.size() + size > envelope.limit) throw WearBridgeFailure("ERR_WEAR_PAYLOAD_TOO_LARGE")
          output.write(buffer, 0, size)
        }
        output.toByteArray()
      }
    } finally { response.release() }
    val payload = WearInbox.strictUtf8(bytes)
    validateIncoming(envelope.path, payload)
    requireEnabled(context)
    if (WearInbox.put(context, envelope.path, payload, envelope.uri.toString(), envelope.digest)) changed(context)
  }

  private fun validateIncoming(path: String, payload: String) {
    val match = watchPath.matchEntire(path) ?: throw WearBridgeFailure("ERR_WEAR_PROTOCOL")
    val json = JSONObject(payload)
    requireVersion(json)
    requireDate(json.optString("dateKey", ""))
    val field = if (match.groupValues[1] == "request") "requestId" else "operationId"
    if (json.optString(field, "") != match.groupValues[2]) throw WearBridgeFailure("ERR_WEAR_PROTOCOL")
    if (field == "operationId") requireMinute(json)
  }

  fun acknowledge(context: Context, id: String) = transport.withLock {
    requireEnabled(context)
    val record = WearInbox.get(context, id) ?: return@withLock
    requireAvailable(context)
    val source = Uri.parse(record.sourceUri)
    if (watchPath.matchEntire(source.path ?: "") == null || source.scheme != "wear" || source.host.isNullOrBlank()) {
      throw WearBridgeFailure("ERR_WEAR_INBOX_CORRUPT")
    }
    val client = Wearable.getDataClient(context)
    val current = waitFor(client.getDataItem(source))
    if (current != null) {
      val currentAsset = DataMapItem.fromDataItem(current).dataMap.getAsset("payload")
      // A different immutable payload using the same operation path must be received
      // separately, not removed by an acknowledgment for the older local record.
      if (currentAsset?.digest == record.assetDigest) {
        requireEnabled(context)
        waitFor(client.deleteDataItems(source, DataClient.FILTER_LITERAL))
      }
    }
    requireEnabled(context)
    WearInbox.removeAcknowledged(context, id)
    changed(context)
    scheduleScan(context.applicationContext)
  }

  private fun scheduleScan(context: Context) {
    if (!scanScheduled.compareAndSet(false, true)) return
    workers.maintain {
      try { if (WearInbox.enabled(context)) scanPending(context) }
      catch (failure: Throwable) { error(failure) }
      finally { scanScheduled.set(false) }
    }
  }

  fun publishDay(context: Context, payload: String) {
    checkPayloadSize(payload, DAY_LIMIT)
    val json = JSONObject(payload)
    requireVersion(json)
    val date = json.optString("dateKey", "")
    requireDate(date)
    publish(context, "$PHONE_PREFIX" + "day/$date", payload, DAY_LIMIT)
  }

  fun publishAck(context: Context, payload: String) {
    checkPayloadSize(payload, ACK_LIMIT)
    val json = JSONObject(payload)
    requireVersion(json)
    val operation = json.optString("operationId", "")
    if (!uuidValue.matches(operation)) throw WearBridgeFailure("ERR_WEAR_PROTOCOL")
    requireDate(json.optString("dateKey", ""))
    requireMinute(json)
    val status = json.optString("status", "")
    if (status !in setOf("applied", "conflict", "error")) throw WearBridgeFailure("ERR_WEAR_PROTOCOL")
    if (status != "error" && json.optJSONObject("entry") == null) throw WearBridgeFailure("ERR_WEAR_PROTOCOL")
    publish(context, "$PHONE_PREFIX" + "ack/$operation", payload, ACK_LIMIT)
  }

  private fun publish(context: Context, path: String, payload: String, limit: Int) {
    val epoch = synchronized(consentLock) { requireEnabled(context); consentEpoch }
    requireAvailable(context)
    val encoded = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(payload))
    if (encoded.remaining() > limit) throw WearBridgeFailure("ERR_WEAR_PAYLOAD_TOO_LARGE")
    val bytes = ByteArray(encoded.remaining())
    encoded.get(bytes)
    val request = PutDataMapRequest.create(path)
    request.dataMap.putInt("protocolVersion", 1)
    request.dataMap.putAsset("payload", Asset.createFromBytes(bytes))
    val sentAt = synchronized(sentAtLock) {
      lastSentAt = maxOf(lastSentAt + 1, System.currentTimeMillis())
      lastSentAt
    }
    request.dataMap.putLong("sentAt", sentAt)
    requireEnabled(context)
    val client = Wearable.getDataClient(context)
    publications.withPath(path) {
      publishWithWearConsent(
        enabled = { synchronized(consentLock) { consentEpoch == epoch && WearInbox.enabled(context) } },
        disabled = { throw WearBridgeFailure("ERR_WEAR_DISABLED") },
        publish = { waitFor(client.putDataItem(request.asPutDataRequest().setUrgent())) },
        withdraw = { published -> waitFor(client.deleteDataItems(published.uri, DataClient.FILTER_LITERAL)); Unit }
      )
    }
  }

  fun status(context: Context): Map<String, Any> {
    val enabled = WearInbox.enabled(context)
    if (!enabled) scheduleWithdrawal(context.applicationContext)
    val pending = WearInbox.count(context)
    var count = 0
    var statusError = lastError
    try {
      requireAvailable(context)
      if (enabled) count = waitFor(Wearable.getNodeClient(context).connectedNodes).size
    } catch (failure: Throwable) {
      statusError = if (failure is WearBridgeFailure) failure.code else "ERR_WEAR_UNAVAILABLE"
    }
    val result = mutableMapOf<String, Any>("enabled" to enabled, "connectedNodeCount" to count, "pendingCount" to pending)
    if (statusError != null) result["error"] = statusError
    return result
  }

  private fun requireVersion(json: JSONObject) {
    val version = json.opt("version")
    if (version !is Number || version.toDouble() != 1.0) throw WearBridgeFailure("ERR_WEAR_PROTOCOL")
  }

  private fun checkPayloadSize(payload: String, limit: Int) {
    // A valid UTF-8 encoding cannot have fewer bytes than UTF-16 code units.
    if (payload.length > limit) throw WearBridgeFailure("ERR_WEAR_PAYLOAD_TOO_LARGE")
    val encoded = StandardCharsets.UTF_8.newEncoder().onMalformedInput(CodingErrorAction.REPORT)
      .onUnmappableCharacter(CodingErrorAction.REPORT).encode(CharBuffer.wrap(payload))
    if (encoded.remaining() > limit) throw WearBridgeFailure("ERR_WEAR_PAYLOAD_TOO_LARGE")
  }

  private fun requireMinute(json: JSONObject) {
    val minute = json.opt("minuteIndex")
    if (minute !is Number || minute.toDouble() != minute.toInt().toDouble() || minute.toInt() !in 0..1439) {
      throw WearBridgeFailure("ERR_WEAR_PROTOCOL")
    }
  }

  private fun requireDate(value: String) {
    if (!dateValue.matches(value)) throw WearBridgeFailure("ERR_WEAR_PROTOCOL")
    val format = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
      isLenient = false
      timeZone = TimeZone.getTimeZone("GMT")
    }
    val position = ParsePosition(0)
    if (format.parse(value, position) == null || position.index != value.length) throw WearBridgeFailure("ERR_WEAR_PROTOCOL")
  }
}
