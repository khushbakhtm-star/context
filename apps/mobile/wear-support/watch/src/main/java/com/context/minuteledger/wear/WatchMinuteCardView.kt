package com.context.minuteledger.wear

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView

/** One recycled minute surface. It holds no storage, clock or microphone ownership. */
class WatchMinuteCardView(context: Context) : FrameLayout(context) {
    private val panel = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(12), dp(9), dp(6), dp(3))
        minimumHeight = dp(WatchCardLayout.MIN_CARD_HEIGHT - WatchCardLayout.CARD_GAP)
    }
    private val note = TextView(context).apply {
        textSize = 14f
        setTextColor(FOREGROUND)
        setTypeface(Typeface.DEFAULT, Typeface.NORMAL)
        includeFontPadding = false
        minLines = 1
        maxLines = WatchCardLayout.NOTE_MAX_LINES
        ellipsize = TextUtils.TruncateAt.END
        gravity = Gravity.TOP or Gravity.START
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    private val metadata = LinearLayout(context).apply { gravity = Gravity.CENTER_VERTICAL }
    private val swatch = View(context).apply { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
    private val timestamp = TextView(context).apply {
        textSize = 10f
        setTextColor(MUTED)
        includeFontPadding = false
        maxLines = 2
        ellipsize = TextUtils.TruncateAt.END
        gravity = Gravity.CENTER_VERTICAL or Gravity.START
        minimumHeight = dp(WatchCardLayout.ACTION_TARGET)
    }
    private val edit = ImageButton(context).apply {
        setImageResource(R.drawable.context_edit)
        setPadding(dp(12), dp(12), dp(12), dp(12))
        background = WatchRoundActionButton.touchBackground(context, visibleCircle = false)
    }

    init {
        setPadding(0, 0, 0, dp(WatchCardLayout.CARD_GAP))
        minimumHeight = dp(WatchCardLayout.MIN_CARD_HEIGHT)
        addView(panel, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        panel.addView(note, LinearLayout.LayoutParams(-1, -2))
        metadata.addView(swatch, LinearLayout.LayoutParams(dp(4), dp(4)).apply { marginEnd = dp(5) })
        metadata.addView(timestamp, LinearLayout.LayoutParams(0, dp(WatchCardLayout.ACTION_TARGET), 1f))
        metadata.addView(edit, LinearLayout.LayoutParams(dp(WatchCardLayout.ACTION_TARGET), dp(WatchCardLayout.ACTION_TARGET)))
        panel.addView(metadata, LinearLayout.LayoutParams(-1, dp(WatchCardLayout.ACTION_TARGET)))
        clipChildren = false
    }

    fun bind(text: String, timestamp: String, selected: Boolean, isNow: Boolean,
        categoryColor: Int?, onEdit: () -> Unit, onOpen: (() -> Unit)? = null,
        onDate: (() -> Unit)? = null) {
        note.text = text
        this.timestamp.text = timestamp
        panel.background = GradientDrawable().apply {
            setColor(PANEL)
            cornerRadius = dp(WatchCardLayout.CARD_RADIUS).toFloat()
            if (selected || isNow) setStroke(dp(1), if (selected) OUTLINE else NOW_OUTLINE)
        }
        swatch.visibility = if (categoryColor == null) GONE else VISIBLE
        swatch.background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(categoryColor ?: MUTED)
        }
        edit.contentDescription = "Edit $timestamp"
        edit.setOnClickListener { onEdit() }
        this.timestamp.contentDescription = if (onDate != null) "Choose day. $timestamp" else timestamp
        this.timestamp.setOnClickListener(if (onDate != null) View.OnClickListener { onDate() } else null)
        this.timestamp.isClickable = onDate != null
        this.timestamp.isFocusable = onDate != null
        this.timestamp.importantForAccessibility = if (onDate != null) IMPORTANT_FOR_ACCESSIBILITY_YES else IMPORTANT_FOR_ACCESSIBILITY_NO
        contentDescription = "${if (text.isBlank()) "Empty minute" else text}. $timestamp${if (isNow) ". Current minute" else ""}."
        setOnClickListener(if (onOpen != null) View.OnClickListener { onOpen() } else null)
        isClickable = onOpen != null
        isFocusable = onOpen != null
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    companion object {
        private val PANEL = Color.parseColor("#202024")
        private val FOREGROUND = Color.parseColor("#F3EFF7")
        private val MUTED = Color.parseColor("#A8A3AF")
        private val OUTLINE = Color.parseColor("#77737E")
        private val NOW_OUTLINE = Color.parseColor("#45434B")
    }
}
