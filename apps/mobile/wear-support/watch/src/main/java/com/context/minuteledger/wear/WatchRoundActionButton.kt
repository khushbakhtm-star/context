package com.context.minuteledger.wear

import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.InsetDrawable
import android.graphics.drawable.StateListDrawable
import android.widget.ImageButton

/** The icon stays quiet while the full 44 dp area remains tappable. */
class WatchRoundActionButton(context: Context, iconRes: Int, description: String,
    action: () -> Unit) : ImageButton(context) {
    init {
        contentDescription = description
        setImageResource(iconRes)
        val inset = ((WatchCardLayout.ACTION_TARGET - WatchCardLayout.ACTION_ICON) / 2f *
            resources.displayMetrics.density).toInt()
        setPadding(inset, inset, inset, inset)
        minimumWidth = dp(WatchCardLayout.ACTION_TARGET)
        minimumHeight = dp(WatchCardLayout.ACTION_TARGET)
        background = touchBackground(context, visibleCircle = true)
        setOnClickListener { action() }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        fun touchBackground(context: Context, visibleCircle: Boolean): StateListDrawable {
            fun circle(color: Int) = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(color)
            }
            val inset = ((WatchCardLayout.ACTION_TARGET - WatchCardLayout.ACTION_CIRCLE) / 2f *
                context.resources.displayMetrics.density).toInt()
            fun surface(color: Int) = InsetDrawable(circle(color), inset)
            return StateListDrawable().apply {
                addState(intArrayOf(android.R.attr.state_pressed), surface(Color.parseColor("#424047")))
                addState(intArrayOf(android.R.attr.state_focused), surface(Color.parseColor("#34323A")))
                addState(intArrayOf(), surface(if (visibleCircle) Color.parseColor("#202024") else Color.TRANSPARENT))
            }
        }
    }
}
