package com.context.minuteledger.wear

import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import java.time.ZonedDateTime

/** Render only locally available minutes; opening a Tile never waits for the phone. */
class ContextTileService : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> {
        val now = ZonedDateTime.now()
        val first = now.withSecond(0).withNano(0)
        val coordinates = (-2 until ContextTileLayout.TIMELINE_MINUTES + 2).map { first.plusMinutes(it.toLong()) }
        val requested = coordinates.map { it.toLocalDate().toString() to it.hour * 60 + it.minute }.toSet()
        val store = WatchStore(this)
        val notes = mutableMapOf<Pair<String, Int>, String>()
        var clockFormat: String? = null
        // Read each adjacent local day once, never once per rendered row.
        for (date in coordinates.map { it.toLocalDate().toString() }.distinct()) {
            val day = runCatching { store.day(date) }.getOrNull()
            if (date == now.toLocalDate().toString()) clockFormat = day?.optString("clockFormat")
            val entries = day?.optJSONArray("entries")
            for (index in 0 until (entries?.length() ?: 0)) {
                val entry = entries!!.optJSONObject(index) ?: continue
                val coordinate = date to entry.optInt("minuteIndex", -1)
                if (coordinate in requested) notes[coordinate] = entry.optString("text")
            }
        }
        // Unsent local edits override older cached values, exactly as in the app list.
        val pending = runCatching { store.pendingRecords() }.getOrDefault(emptyList())
        for (record in pending) {
            val operation = record.optJSONObject("operation") ?: continue
            val coordinate = operation.optString("dateKey") to operation.optInt("minuteIndex", -1)
            if (coordinate in requested) notes[coordinate] = operation.optString("text")
        }
        val twelveHourClock = when (clockFormat) {
            "12h" -> true
            "24h" -> false
            else -> !android.text.format.DateFormat.is24HourFormat(this)
        }
        return ready(ContextTileLayout.tile(packageName, MinuteActivity::class.java.name, now, twelveHourClock) { date, minute ->
            notes[date to minute].orEmpty()
        })
    }

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        ready(ResourceBuilders.Resources.Builder().setVersion(ContextTileLayout.RESOURCES_VERSION).build())

    /** Avoid a full Guava dependency for an already completed local result. */
    private fun <T> ready(value: T): ListenableFuture<T> = object : ListenableFuture<T> {
        override fun addListener(listener: Runnable, executor: Executor) { executor.execute(listener) }
        override fun cancel(mayInterruptIfRunning: Boolean) = false
        override fun isCancelled() = false
        override fun isDone() = true
        override fun get(): T = value
        override fun get(timeout: Long, unit: TimeUnit): T = value
    }
}
