package com.context.minuteledger.wear

import android.content.Context
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/** One atomic journal shared by the activity and the background Data Layer listener. */
class WatchStore(context: Context) {
    private val file = AtomicFile(File(context.filesDir, "context-watch-v1.json"))

    private fun read(): JSONObject {
        // openRead restores AtomicFile's backup after a process dies during a write.
        // Checking only the base file first would skip that recovery and lose the journal.
        return try { file.openRead().bufferedReader().use { JSONObject(it.readText()) } }
        catch (error: java.io.FileNotFoundException) {
            if (file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()) throw error
            JSONObject().put("days", JSONObject()).put("pending", JSONArray())
        }
    }
    private fun write(state: JSONObject) {
        val output = file.startWrite()
        try { output.write(state.toString().toByteArray(Charsets.UTF_8)); file.finishWrite(output) }
        catch (error: Throwable) { file.failWrite(output); throw error }
    }
    fun day(dateKey: String): JSONObject? = synchronized(lock) {
        read().getJSONObject("days").optJSONObject(dateKey)?.let { JSONObject(it.toString()) }
    }
    fun cachedEntry(dateKey: String, minute: Int): JSONObject? = synchronized(lock) {
        val entries = read().getJSONObject("days").optJSONObject(dateKey)?.optJSONArray("entries") ?: JSONArray()
        (0 until entries.length()).map { entries.getJSONObject(it) }.firstOrNull { it.optInt("minuteIndex") == minute }
            ?.let { JSONObject(it.toString()) }
    }
    fun save(coordinate: Coordinate, text: String, category: String?, baseKnown: Boolean,
        expectedVersion: String?): JSONObject = synchronized(lock) {
        val state = read()
        val operation = JSONObject().put("version", 1).put("operationId", UUID.randomUUID().toString())
            .put("dateKey", coordinate.dateKey).put("minuteIndex", coordinate.minuteIndex).put("text", text)
            .put("baseKnown", baseKnown).put("expectedVersion", expectedVersion ?: JSONObject.NULL)
        if (category != null) operation.put("categoryId", category)
        require(operation.toString().toByteArray(Charsets.UTF_8).size <= 256 * 1024) { "The watch edit is too large." }
        state.getJSONArray("pending").put(JSONObject().put("operation", operation).put("status", "pending"))
        write(state)
        JSONObject(operation.toString())
    }
    fun pendingRecords(): List<JSONObject> = synchronized(lock) {
        val list = read().getJSONArray("pending")
        (0 until list.length()).map { JSONObject(list.getJSONObject(it).toString()) }
    }
    fun operations(): List<JSONObject> = pendingRecords().map { it.getJSONObject("operation") }
    fun latest(dateKey: String, minute: Int): JSONObject? = pendingRecords().lastOrNull {
        it.getJSONObject("operation").let { op -> op.optString("dateKey") == dateKey && op.optInt("minuteIndex") == minute }
    }
    fun acceptDay(day: JSONObject) = synchronized(lock) {
        val date = day.getString("dateKey"); Coordinate(date, 0)
        val validatedEntries = day.getJSONArray("entries")
        val seen = mutableSetOf<Int>()
        for (index in 0 until validatedEntries.length()) {
            val entry = validatedEntries.getJSONObject(index)
            val minute = entry.getInt("minuteIndex")
            require(minute in 0..1439 && seen.add(minute)) { "Invalid phone day coordinates" }
            entry.getString("text"); entry.getString("categoryId"); entry.getString("version")
        }
        val state = read(); val days = state.getJSONObject("days")
        val current = days.optJSONObject(date)
        if (current == null || LedgerRules.newerSnapshot(day.optLong("generatedAt"), current.optLong("generatedAt"))) {
            val incoming = JSONObject(day.toString())
            val newEntries = incoming.getJSONArray("entries")
            val previousEntries = current?.optJSONArray("entries") ?: JSONArray()
            // A response created before a recent edit may arrive after its applied ACK.
            // Preserve the newer HLC minute until a snapshot catches up, including tombstones.
            for (index in 0 until previousEntries.length()) {
                val old = previousEntries.getJSONObject(index)
                val newIndex = (0 until newEntries.length()).firstOrNull {
                    newEntries.getJSONObject(it).getInt("minuteIndex") == old.getInt("minuteIndex")
                }
                val fresh = newIndex?.let { newEntries.getJSONObject(it) }
                if (olderThan(fresh, old)) {
                    if (newIndex != null) newEntries.put(newIndex, old) else newEntries.put(old)
                }
            }
            days.put(date, incoming)
            // Bound the history cache, never the immutable pending journal.
            val dates = days.keys().asSequence().toList().sorted()
            if (dates.size > 45) dates.filter { it != date }.take(dates.size - 45).forEach { days.remove(it) }
            // A few unusually long days must not grow a tiny watch's history cache indefinitely.
            for (oldDate in days.keys().asSequence().toList().sorted().filter { it != date }) {
                if (days.toString().toByteArray(Charsets.UTF_8).size <= 12 * 1024 * 1024) break
                days.remove(oldDate)
            }
            write(state)
        }
    }
    fun acceptAck(ack: JSONObject): Boolean = synchronized(lock) {
        val state = read(); val list = state.getJSONArray("pending"); val id = ack.getString("operationId")
        val index = (0 until list.length()).firstOrNull {
            list.getJSONObject(it).getJSONObject("operation").getString("operationId") == id
        } ?: return@synchronized false
        val record = list.getJSONObject(index); val operation = record.getJSONObject("operation")
        val date = operation.getString("dateKey"); val minute = operation.getInt("minuteIndex")
        if (ack.getString("dateKey") != date || ack.getInt("minuteIndex") != minute) return@synchronized false
        require(ack.optString("status") in setOf("applied", "conflict", "error")) { "Invalid phone receipt status" }
        if (ack.optString("status") == "applied" || ack.optString("status") == "conflict") {
            val entry = ack.getJSONObject("entry")
            require(entry.getInt("minuteIndex") == minute) { "Invalid phone receipt coordinate" }
            entry.getString("text"); entry.getString("categoryId"); entry.getString("version")
        }
        if (ack.optString("status") == "applied") {
            val latest = (0 until list.length()).map { list.getJSONObject(it).getJSONObject("operation") }
                .lastOrNull { it.getString("dateKey") == date && it.getInt("minuteIndex") == minute }
            if (LedgerRules.mayApplyAckToCache(id, latest?.getString("operationId")) && ack.has("entry")) {
                val days = state.getJSONObject("days")
                val day = days.optJSONObject(date) ?: JSONObject().put("dateKey", date).put("generatedAt", 0L)
                    .put("entries", JSONArray()).put("categories", JSONArray()).put("partial", true)
                val entries = day.getJSONArray("entries")
                for (entryIndex in entries.length() - 1 downTo 0) {
                    if (entries.getJSONObject(entryIndex).getInt("minuteIndex") == minute) entries.remove(entryIndex)
                }
                val acknowledged = ack.optJSONObject("entry")
                val current = cachedEntry(date, minute)
                if (acknowledged != null && !olderThan(acknowledged, current)) entries.put(acknowledged)
                else if (current != null) entries.put(current)
                days.put(date, day)
            }
            list.remove(index)
        } else {
            record.put("status", ack.optString("status", "error"))
                .put("message", ack.optString("message", "The phone could not apply this edit."))
                .put("currentEntry", ack.optJSONObject("entry") ?: JSONObject.NULL)
        }
        write(state); true
    }
    private fun revisions(entry: JSONObject?): Pair<String, String> = runCatching {
        val parts = JSONArray(entry?.optString("version") ?: "[null,null]")
        val minute = parts.optString(0).takeUnless { it == "null" } ?: ""
        val format = parts.optString(1).takeUnless { it == "null" } ?: ""
        minute to format
    }.getOrDefault("" to "")
    private fun olderThan(incoming: JSONObject?, cached: JSONObject?): Boolean {
        val next = revisions(incoming); val previous = revisions(cached)
        return LedgerRules.olderCell(next.first, next.second, previous.first, previous.second)
    }
    companion object { private val lock = Any() }
}
