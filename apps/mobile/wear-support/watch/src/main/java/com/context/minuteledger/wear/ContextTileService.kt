package com.context.minuteledger.wear

import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

/** A static private-by-default shortcut. The Activity resolves Now when the user taps. */
class ContextTileService : TileService() {
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): ListenableFuture<TileBuilders.Tile> =
        ready(ContextTileLayout.tile(packageName, MinuteActivity::class.java.name,
            getString(R.string.context_tile_label), getString(R.string.context_tile_record_now),
            getString(R.string.context_tile_description)))

    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest): ListenableFuture<ResourceBuilders.Resources> =
        ready(ResourceBuilders.Resources.Builder().setVersion(ContextTileLayout.RESOURCES_VERSION).build())

    /** Both callbacks construct static values synchronously. Avoid a full Guava dependency for an already completed future. */
    private fun <T> ready(value: T): ListenableFuture<T> = object : ListenableFuture<T> {
        override fun addListener(listener: Runnable, executor: Executor) { executor.execute(listener) }
        override fun cancel(mayInterruptIfRunning: Boolean) = false
        override fun isCancelled() = false
        override fun isDone() = true
        override fun get(): T = value
        override fun get(timeout: Long, unit: TimeUnit): T = value
    }
}
