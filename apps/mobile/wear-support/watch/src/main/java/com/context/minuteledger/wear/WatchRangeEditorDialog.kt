package com.context.minuteledger.wear

import android.app.Activity
import android.app.Dialog
import android.graphics.Color
import android.os.Bundle
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/** An explicit, bounded text fill; merely opening or restoring it never writes a minute. */
class WatchRangeEditorDialog(
    private val activity: Activity,
    private val store: WatchStore,
    private val selected: Coordinate,
    private val twelveHourClock: Boolean,
    restored: Bundle?,
    private val onSaved: (Coordinate) -> Unit,
    private val onClosed: () -> Unit,
    private val isActive: () -> Boolean = { true },
) {
    private var closed = false
    private var completed = false
    private var confirmation: Dialog? = null
    private val inputs = linkedMapOf<String, EditText>()
    private val text = input("text", restored, "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE).apply {
        textSize = 14f
        minLines = 2
        maxLines = 5
        filters = arrayOf(InputFilter.LengthFilter(WatchRangePolicy.MAX_TEXT_LENGTH))
        contentDescription = "Text to put in every selected minute"
        gravity = Gravity.TOP or Gravity.START
    }
    private val fromDate = input("fromDate", restored, selected.dateKey, InputType.TYPE_CLASS_DATETIME).apply {
        contentDescription = "From date, YYYY-MM-DD"
    }
    private val fromTime = input("fromTime", restored, clock(selected), InputType.TYPE_CLASS_DATETIME or InputType.TYPE_DATETIME_VARIATION_TIME).apply {
        contentDescription = "From time, HH:mm in 24-hour time"
    }
    private val throughDate = input("throughDate", restored, selected.dateKey, InputType.TYPE_CLASS_DATETIME).apply {
        contentDescription = "Through date, YYYY-MM-DD"
    }
    private val throughTime = input("throughTime", restored, clock(selected), InputType.TYPE_CLASS_DATETIME or InputType.TYPE_DATETIME_VARIATION_TIME).apply {
        contentDescription = "Through time, HH:mm in 24-hour time; includes the whole minute"
    }
    private val error = label(restored?.getString("error") ?: "", 11f).apply {
        setTextColor(WARNING)
        accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
    }
    private val save = button("Save", "Save the text to all minutes from From through Through") { prepareSave() }
    val dialog: Dialog

    init {
        val content = column().apply { setPadding(dp(24), dp(18), dp(24), dp(18)) }
        val body = column()
        body.addView(label("Add text", 15f).apply { gravity = Gravity.CENTER })
        body.addView(label(initialLabel(), 10f).apply { gravity = Gravity.CENTER; setTextColor(MUTED) })
        body.addView(text, LinearLayout.LayoutParams(-1, -2))
        field(body, "From date · YYYY-MM-DD", fromDate)
        field(body, "From time · 24h", fromTime)
        field(body, "Through date · YYYY-MM-DD", throughDate)
        field(body, "Through time · 24h, inclusive", throughTime)
        body.addView(error, LinearLayout.LayoutParams(-1, -2))
        val scrolling = ScrollView(activity).apply { isFillViewport = true; addView(body) }
        content.addView(scrolling, LinearLayout.LayoutParams(-1, 0, 1f))
        val actions = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL }
        actions.addView(button("Cancel", "Return without changing any minute") { dismiss() },
            LinearLayout.LayoutParams(0, dp(44), 1f))
        actions.addView(save, LinearLayout.LayoutParams(0, dp(44), 1f))
        content.addView(actions, LinearLayout.LayoutParams(-1, dp(44)))
        dialog = Dialog(activity).apply {
            requestWindowFeature(Window.FEATURE_NO_TITLE)
            setContentView(content)
            window?.setBackgroundDrawableResource(android.R.color.black)
            window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
                WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
            setOnShowListener {
                window?.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
                val focus = restored?.getString("focused")?.let { inputs[it] }
                if (focus != null) {
                    focus.requestFocus()
                    val start = (restored?.getInt("selectionStart", focus.text.length) ?: focus.text.length).coerceIn(0, focus.text.length)
                    val end = (restored?.getInt("selectionEnd", start) ?: start).coerceIn(start, focus.text.length)
                    focus.setSelection(start, end)
                }
            }
            // MinuteActivity's picker hook may replace this listener. It must
            // chain hostClosed() so a child confirmation cannot outlive us.
            setOnDismissListener { hostClosed() }
        }
    }

    /** Preserve raw, possibly incomplete fields rather than silently reparsing them on rotation. */
    fun draft(): Bundle = Bundle().apply {
        for ((key, input) in inputs) putString(key, input.text.toString())
        putString("error", error.text.toString())
        inputs.entries.firstOrNull { it.value.hasFocus() }?.let { (key, input) ->
            putString("focused", key)
            putInt("selectionStart", input.selectionStart.coerceAtLeast(0))
            putInt("selectionEnd", input.selectionEnd.coerceAtLeast(0))
        }
    }

    fun dismiss() {
        hostClosed()
        dialog.dismiss()
    }

    /** Called exactly once by the owner's parent-dialog dismiss hook. */
    fun hostClosed() {
        if (closed) return
        closed = true
        val previous = confirmation
        confirmation = null
        previous?.dismiss()
        hideKeyboard()
        onClosed()
    }

    private fun current(): Boolean = !closed && !completed && isActive() && dialog.isShowing &&
        !activity.isFinishing && !activity.isDestroyed

    private fun prepareSave() {
        if (!current() || confirmation != null) return
        val start = WatchRangePolicy.coordinate(fromDate.text.toString(), fromTime.text.toString())
        val end = WatchRangePolicy.coordinate(throughDate.text.toString(), throughTime.text.toString())
        if (start == null || end == null) {
            error.text = "Use YYYY-MM-DD and HH:mm in 24-hour time."
            return
        }
        val plan = try {
            store.prepareRange(start, end, text.text.toString())
        } catch (exception: IllegalArgumentException) {
            error.text = exception.message ?: "Choose 1–1440 minutes and enter text."
            return
        } catch (_: Exception) {
            error.text = "Could not check these minutes. Your text is kept here."
            return
        }
        if (!current()) return
        error.text = ""
        hideKeyboard()
        if (plan.hasOccupied) confirmReplacement(plan) else commit(plan)
    }

    private fun confirmReplacement(plan: WatchRangePlan) {
        if (!current() || confirmation != null) return
        val content = column().apply { setPadding(dp(25), dp(24), dp(25), dp(20)) }
        val body = column()
        body.addView(label("Replace existing text?", 14f).apply { gravity = Gravity.CENTER })
        body.addView(label("${plan.count} minute${if (plan.count == 1) "" else "s"}. Your new text will replace different text in this range.", 12f))
        content.addView(ScrollView(activity).apply { isFillViewport = true; addView(body) },
            LinearLayout.LayoutParams(-1, 0, 1f))
        val child = Dialog(activity)
        val actions = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL }
        actions.addView(button("Cancel", "Keep the original minute text and return to the range editor") {
            if (confirmation !== child) return@button
            confirmation = null
            child.dismiss()
        }, LinearLayout.LayoutParams(0, dp(44), 1f))
        actions.addView(button("Replace", "Replace the text in the reviewed minute range") {
            // The same prepared plan is used after confirmation. A phone update,
            // acknowledgement or local edit invalidates it inside saveRange.
            if (!current() || confirmation !== child || !child.isShowing) return@button
            confirmation = null
            child.dismiss()
            commit(plan)
        }, LinearLayout.LayoutParams(0, dp(44), 1f))
        content.addView(actions, LinearLayout.LayoutParams(-1, dp(44)))
        child.requestWindowFeature(Window.FEATURE_NO_TITLE)
        child.setContentView(content)
        child.window?.setBackgroundDrawableResource(android.R.color.black)
        child.setOnShowListener { child.window?.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT) }
        child.setOnDismissListener { if (confirmation === child) confirmation = null }
        confirmation = child
        if (current()) child.show() else { confirmation = null; child.dismiss() }
    }

    private fun commit(plan: WatchRangePlan) {
        if (!current() || confirmation != null) return
        save.isEnabled = false
        try {
            store.saveRange(plan)
        } catch (exception: IllegalArgumentException) {
            error.text = exception.message ?: "These minutes changed. Review the range and try again."
            save.isEnabled = true
            return
        } catch (_: Exception) {
            error.text = "Could not confirm saving. Your text is kept here. Try again."
            save.isEnabled = true
            return
        }
        completed = true
        try { onSaved(plan.start) } finally { dismiss() }
    }

    private fun input(key: String, restored: Bundle?, fallback: String, type: Int): EditText = EditText(activity).apply {
        setText(restored?.getString(key) ?: fallback)
        setTextColor(FOREGROUND)
        setHintTextColor(MUTED)
        textSize = 13f
        minHeight = dp(44)
        // Hint the keyboard without filtering a malformed pasted date into a
        // different valid one; the strict policy parser checks the raw fields.
        setRawInputType(type)
        if (key != "text") isSingleLine = true
        inputs[key] = this
    }

    private fun field(parent: LinearLayout, title: String, input: EditText) {
        parent.addView(label(title, 10f).apply { setTextColor(MUTED) }, LinearLayout.LayoutParams(-1, -2))
        parent.addView(input, LinearLayout.LayoutParams(-1, dp(44)))
    }

    private fun initialLabel(): String {
        val time = if (twelveHourClock) {
            val hour = selected.minuteIndex / 60
            "%d:%02d %s".format(if (hour % 12 == 0) 12 else hour % 12, selected.minuteIndex % 60,
                if (hour < 12) "AM" else "PM")
        } else clock(selected)
        return "${LocalDate.parse(selected.dateKey).format(DateTimeFormatter.ofPattern("MMM d"))} · $time"
    }

    private fun hideKeyboard() {
        val token = inputs.values.firstOrNull { it.hasFocus() }?.windowToken
        if (token != null) {
            (activity.getSystemService(Activity.INPUT_METHOD_SERVICE) as? InputMethodManager)
                ?.hideSoftInputFromWindow(token, 0)
        }
        inputs.values.forEach { it.clearFocus() }
    }

    private fun column() = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(BACKGROUND)
    }
    private fun label(text: String, size: Float) = TextView(activity).apply {
        this.text = text; textSize = size; setTextColor(FOREGROUND)
    }
    private fun button(text: String, description: String, action: () -> Unit) = Button(activity).apply {
        this.text = text; textSize = 11f; isAllCaps = false; contentDescription = description
        minWidth = 0; minimumWidth = 0; minHeight = dp(44); minimumHeight = dp(44)
        setPadding(0, 0, 0, 0); setTextColor(FOREGROUND); setOnClickListener { action() }
    }
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    companion object {
        private val BACKGROUND = Color.parseColor("#08090B")
        private val FOREGROUND = Color.parseColor("#F3EFF7")
        private val MUTED = Color.parseColor("#A8A3AF")
        private val WARNING = Color.parseColor("#E6B585")
        private fun clock(coordinate: Coordinate) = "%02d:%02d".format(coordinate.minuteIndex / 60, coordinate.minuteIndex % 60)
    }
}
