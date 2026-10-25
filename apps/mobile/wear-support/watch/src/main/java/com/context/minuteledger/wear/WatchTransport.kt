package com.context.minuteledger.wear

import android.content.Context
import android.content.Intent
import android.net.Uri
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.Asset
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.wearable.WearableListenerService
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

object WatchTransport {
    const val ACTION_CHANGED = "com.context.minuteledger.wear.CHANGED"
    private val worker = Executors.newSingleThreadExecutor()
    private const val ROOT = "/context/v1/"
    @Volatile var lastError: String? = null
        private set

    fun synchronize(context: Context, dateKey: String) = worker.execute {
        val app = context.applicationContext
        runCatching {
            requireAvailable(app)
            val client = Wearable.getDataClient(app)
            val pendingIds = WatchStore(app).operations().map { it.getString("operationId") }.toSet()
            val items = Tasks.await(client.dataItems, 25, TimeUnit.SECONDS)
            try {
                for (item in items) {
                    val path = item.uri.path ?: continue
                    if (path == ROOT + "phone/day/" + dateKey ||
                        (path.startsWith(ROOT + "phone/ack/") && path.substringAfterLast('/') in pendingIds)) {
                        val data = DataMapItem.fromDataItem(item).dataMap
                        data.getAsset("payload")?.let { receive(app, path, it) }
                    }
                }
            } finally { items.release() }
            uploadPending(app)
            lastError = null
        }.onFailure { lastError = "Connection paused. Your edits are saved on this watch." }
        changed(app)
    }

    fun requestDay(context: Context, dateKey: String) = worker.execute {
        val app = context.applicationContext
        runCatching {
            val requestId = UUID.randomUUID().toString()
            val pendingIds = WatchStore(app).operations().filter { it.optString("dateKey") == dateKey }
                .takeLast(32).map { it.getString("operationId") }
            put(app, ROOT + "watch/request/" + requestId, JSONObject().put("version", 1)
                .put("requestId", requestId).put("dateKey", dateKey)
                .put("pendingOperationIds", org.json.JSONArray(pendingIds)))
            lastError = null
        }.onFailure { lastError = "Open Context on your paired phone to load this day." }
        changed(app)
    }

    fun sendPending(context: Context) = worker.execute {
        val app = context.applicationContext
        runCatching { uploadPending(app); lastError = null }
            .onFailure { lastError = "Connection paused. Your edits are saved on this watch." }
        changed(app)
    }

    fun enqueueReceive(context: Context, path: String, asset: Asset) = worker.execute {
        val app = context.applicationContext
        runCatching { receive(app, path, asset); lastError = null }
            .onFailure { lastError = "Could not read the phone response. Your watch edits are safe." }
        changed(app)
    }

    private fun requireAvailable(context: Context) {
        check(GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS) {
            "Wear OS Data Layer is unavailable"
        }
    }

    private fun put(context: Context, path: String, body: JSONObject) {
        requireAvailable(context)
        val data = PutDataMapRequest.create(path)
        data.dataMap.putInt("protocolVersion", 1)
        data.dataMap.putAsset("payload", Asset.createFromBytes(body.toString().toByteArray(Charsets.UTF_8)))
        Tasks.await(Wearable.getDataClient(context).putDataItem(data.asPutDataRequest().setUrgent()), 25, TimeUnit.SECONDS)
    }

    private fun uploadPending(context: Context) {
        for (record in WatchStore(context).pendingRecords()) {
            if (record.optString("status") != "pending") continue
            val operation = record.getJSONObject("operation")
            put(context, ROOT + "watch/edit/" + operation.getString("operationId"), operation)
        }
    }

    private fun receive(context: Context, path: String, asset: Asset) {
        val client = Wearable.getDataClient(context)
        val response = Tasks.await(client.getFdForAsset(asset), 25, TimeUnit.SECONDS)
        val body = try {
            requireNotNull(response.inputStream) { "Phone Asset is unavailable" }.use { input ->
                // Assets support a whole day and long notes. Reject unreasonable/corrupt responses
                // before allocating the corresponding string or replacing any local state.
                val output = java.io.ByteArrayOutputStream()
                val buffer = ByteArray(8192)
                while (true) {
                    val count = input.read(buffer)
                    if (count < 0) break
                    require(output.size() + count <= 8 * 1024 * 1024) { "Phone response exceeds the protocol limit" }
                    output.write(buffer, 0, count)
                }
                val bytes = output.toByteArray()
                val json = Charsets.UTF_8.newDecoder()
                    .onMalformedInput(java.nio.charset.CodingErrorAction.REPORT)
                    .onUnmappableCharacter(java.nio.charset.CodingErrorAction.REPORT)
                    .decode(java.nio.ByteBuffer.wrap(bytes)).toString()
                JSONObject(json)
            }
        } finally { response.release() }
        require(body.getInt("version") == 1)
        val store = WatchStore(context)
        when {
            path.startsWith(ROOT + "phone/day/") -> {
                require(path == ROOT + "phone/day/" + body.getString("dateKey"))
                store.acceptDay(body)
                body.optString("requestId").takeIf { it.isNotEmpty() }?.let {
                    Tasks.await(client.deleteDataItems(Uri.parse("wear://*/" + "context/v1/watch/request/" + it),
                        DataClient.FILTER_LITERAL), 15, TimeUnit.SECONDS)
                }
            }
            path.startsWith(ROOT + "phone/ack/") -> {
                val id = body.getString("operationId")
                require(path == ROOT + "phone/ack/" + id)
                if (store.acceptAck(body) && body.optString("status") == "applied") {
                    Tasks.await(client.deleteDataItems(Uri.parse("wear://*/context/v1/watch/edit/" + id),
                        DataClient.FILTER_LITERAL), 15, TimeUnit.SECONDS)
                }
            }
        }
    }

    fun changed(context: Context) {
        context.sendBroadcast(Intent(ACTION_CHANGED).setPackage(context.packageName))
    }
}

class WatchDataService : WearableListenerService() {
    override fun onDataChanged(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            val path = event.dataItem.uri.path ?: continue
            if (!path.startsWith("/context/v1/phone/")) continue
            val data = DataMapItem.fromDataItem(event.dataItem).dataMap
            if (data.getInt("protocolVersion", 0) != 1) continue
            data.getAsset("payload")?.let { WatchTransport.enqueueReceive(this, path, it) }
        }
    }
}
