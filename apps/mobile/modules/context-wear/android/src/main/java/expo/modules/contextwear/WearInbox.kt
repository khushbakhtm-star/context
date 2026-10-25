package expo.modules.contextwear

import android.content.Context
import android.system.Os
import android.system.OsConstants
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.UUID

internal class WearBridgeFailure(val code: String) : Exception(code)

internal data class InboxRecord(
  val id: String,
  val path: String,
  val payload: String,
  val receivedAt: Long,
  val sourceUri: String,
  val assetDigest: String
) {
  fun publicValue(): Map<String, Any> = mapOf(
    "id" to id, "path" to path, "payload" to payload, "receivedAt" to receivedAt
  )
}

/** App-private, excluded from OS backup, and never removes a committed record without JS acknowledgment. */
internal object WearInbox {
  const val MAX_RECORDS = 128
  const val MAX_INBOX_BYTES = 8L * 1024 * 1024
  private const val MAX_RECORD_BYTES = 600 * 1024L
  private val recordName = Regex("[a-f0-9]{64}\\.json")
  private val recordId = Regex("[a-f0-9]{64}")

  private fun root(context: Context): File = File(context.noBackupFilesDir, "context-wear-v1").also {
    if (!it.isDirectory && !it.mkdirs()) throw WearBridgeFailure("ERR_WEAR_IO")
  }

  private fun directory(context: Context): File = File(root(context), "inbox").also {
    if (!it.isDirectory && !it.mkdirs()) throw WearBridgeFailure("ERR_WEAR_IO")
  }

  private fun files(context: Context): List<File> =
    directory(context).listFiles()?.filter { it.isFile && recordName.matches(it.name) }
      ?: throw WearBridgeFailure("ERR_WEAR_IO")

  @Synchronized
  fun enabled(context: Context): Boolean = File(root(context), "enabled").let { file ->
    file.isFile && file.length() == 1L && file.readText(StandardCharsets.US_ASCII) == "1"
  }

  @Synchronized
  fun setEnabled(context: Context, enabled: Boolean) {
    atomicWrite(File(root(context), "enabled"), if (enabled) byteArrayOf(49) else byteArrayOf(48))
  }

  @Synchronized
  fun count(context: Context): Int = files(context).size

  @Synchronized
  fun containsAsset(context: Context, uri: String, digest: String): Boolean =
    files(context).any { file -> read(file).let { it.sourceUri == uri && it.assetDigest == digest } }

  @Synchronized
  fun put(context: Context, path: String, payload: String, sourceUri: String, digest: String): Boolean {
    val id = sha256((sourceUri + "\n" + sha256(payload.toByteArray(StandardCharsets.UTF_8))).toByteArray(StandardCharsets.UTF_8))
    val target = File(directory(context), "$id.json")
    if (target.isFile) return false
    val record = JSONObject().put("id", id).put("path", path).put("payload", payload)
      .put("receivedAt", System.currentTimeMillis()).put("sourceUri", sourceUri).put("assetDigest", digest)
    val bytes = record.toString().toByteArray(StandardCharsets.UTF_8)
    val records = files(context)
    if (bytes.size > MAX_RECORD_BYTES || records.size >= MAX_RECORDS ||
      records.sumOf { it.length() } + bytes.size > MAX_INBOX_BYTES) throw WearBridgeFailure("ERR_WEAR_INBOX_FULL")
    atomicWrite(target, bytes)
    return true
  }

  @Synchronized
  fun drain(context: Context): List<InboxRecord> = files(context).map(::read)
    .sortedWith(compareBy<InboxRecord> { it.receivedAt }.thenBy { it.id }).take(32)

  @Synchronized
  fun get(context: Context, id: String): InboxRecord? {
    if (!recordId.matches(id)) throw WearBridgeFailure("ERR_WEAR_INVALID_INBOX_ID")
    val file = File(directory(context), "$id.json")
    return if (file.isFile) read(file) else null
  }

  @Synchronized
  fun removeAcknowledged(context: Context, id: String) {
    if (!recordId.matches(id)) throw WearBridgeFailure("ERR_WEAR_INVALID_INBOX_ID")
    val file = File(directory(context), "$id.json")
    if (file.exists() && !file.delete()) throw WearBridgeFailure("ERR_WEAR_IO")
    syncDirectory(directory(context))
  }

  private fun read(file: File): InboxRecord {
    if (file.length() > MAX_RECORD_BYTES) throw WearBridgeFailure("ERR_WEAR_INBOX_CORRUPT")
    val json = JSONObject(strictUtf8(file.readBytes()))
    val record = InboxRecord(json.getString("id"), json.getString("path"), json.getString("payload"),
      json.getLong("receivedAt"), json.getString("sourceUri"), json.getString("assetDigest"))
    if (!recordId.matches(record.id) || file.name != record.id + ".json") throw WearBridgeFailure("ERR_WEAR_INBOX_CORRUPT")
    return record
  }

  private fun atomicWrite(target: File, bytes: ByteArray) {
    val parent = target.parentFile ?: throw WearBridgeFailure("ERR_WEAR_IO")
    val temporary = File(parent, ".${target.name}.${UUID.randomUUID()}.tmp")
    try {
      FileOutputStream(temporary).use { stream -> stream.write(bytes); stream.fd.sync() }
      if (!temporary.renameTo(target)) throw WearBridgeFailure("ERR_WEAR_IO")
      syncDirectory(parent)
    } finally {
      // This is an uncommitted temporary file, never an acknowledged inbox record.
      if (temporary.exists()) temporary.delete()
    }
  }

  private fun syncDirectory(directory: File) {
    val fd = Os.open(directory.absolutePath, OsConstants.O_RDONLY or OsConstants.O_DIRECTORY, 0)
    try { Os.fsync(fd) } finally { Os.close(fd) }
  }

  fun strictUtf8(bytes: ByteArray): String = StandardCharsets.UTF_8.newDecoder()
    .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
    .decode(ByteBuffer.wrap(bytes)).toString()

  private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes)
    .joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }
}
