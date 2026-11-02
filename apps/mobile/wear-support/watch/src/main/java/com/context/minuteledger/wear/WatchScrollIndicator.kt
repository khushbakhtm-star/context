package com.context.minuteledger.wear

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View

/** An overlay only: touch, rotary input and TalkBack remain owned by the ledger. */
class WatchScrollIndicator(context: Context) : View(context) {
    private var thumb: WatchScrollThumb? = null
    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.parseColor("#38383E")
        style = Paint.Style.STROKE
        strokeWidth = dp(2f)
        strokeCap = Paint.Cap.ROUND
    }
    private val thumbPaint = Paint(trackPaint).apply { color = Color.parseColor("#C5C2CA") }
    private val bounds = RectF()

    init {
        isClickable = false
        isFocusable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    fun update(firstVisible: Int, visibleRows: Int, totalRows: Int,
        firstVisibleFraction: Float = 0f) {
        val next = WatchCardLayout.scrollThumb(firstVisible, visibleRows, totalRows, firstVisibleFraction)
        if (next != thumb) { thumb = next; invalidate() }
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val current = thumb ?: return
        val inset = dp(WatchCardLayout.EDGE_INSET.toFloat())
        if (width <= inset * 2 || height <= inset * 2) return
        bounds.set(inset, inset, width - inset, height - inset)
        canvas.drawArc(bounds, WatchCardLayout.ARC_START, WatchCardLayout.ARC_SWEEP, false, trackPaint)
        canvas.drawArc(bounds, current.start, current.sweep, false, thumbPaint)
    }

    private fun dp(value: Float) = value * resources.displayMetrics.density
}
