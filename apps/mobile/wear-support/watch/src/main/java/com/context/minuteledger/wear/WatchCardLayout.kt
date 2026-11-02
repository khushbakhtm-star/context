package com.context.minuteledger.wear

/** Geometry shared by the minute cards and their non-interactive edge indicator. */
object WatchCardLayout {
    const val CARD_GAP = 8
    const val MIN_CARD_HEIGHT = 88
    const val ACTION_TARGET = 44
    const val ACTION_CIRCLE = 30
    const val ACTION_ICON = 20
    const val CARD_RADIUS = 22
    const val NOTE_MAX_LINES = 3
    const val EDGE_INSET = 3
    const val ARC_START = -42f
    const val ARC_SWEEP = 84f
    const val MIN_THUMB_SWEEP = 8f

    /** Blank space must remain around every 44 dp button, even on a 198 dp watch. */
    fun actionSideSpace(width: Int) = ((width - 3 * ACTION_TARGET) / 2).coerceAtLeast(0)

    /**
     * firstVisibleFraction is the hidden fraction of the first row, not screen
     * pixels. Indeterminate/invalid inputs never produce a misleading thumb.
     * first/last positions map to the exact ends of the track despite the
     * minimum thumb size used to keep 1,440-minute days readable.
     */
    fun scrollThumb(firstVisible: Int, visibleRows: Int, totalRows: Int,
        firstVisibleFraction: Float = 0f): WatchScrollThumb? {
        if (totalRows <= 0 || visibleRows <= 0 || firstVisible < 0 ||
            firstVisible >= totalRows || !firstVisibleFraction.isFinite()) return null
        val visible = visibleRows.coerceAtMost(totalRows)
        if (visible == totalRows) return null
        val hiddenFraction = firstVisibleFraction.coerceIn(0f, 1f)
        val extent = (visible.toFloat() - hiddenFraction).coerceAtLeast(0.01f)
        val available = (totalRows.toFloat() - extent).coerceAtLeast(0.01f)
        val offset = (firstVisible + hiddenFraction).coerceIn(0f, available)
        val sweep = (ARC_SWEEP * extent / totalRows).coerceIn(MIN_THUMB_SWEEP, ARC_SWEEP)
        val start = ARC_START + (ARC_SWEEP - sweep) * offset / available
        return WatchScrollThumb(start, sweep)
    }
}

data class WatchScrollThumb(val start: Float, val sweep: Float)
