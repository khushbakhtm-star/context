package com.context.minuteledger.wear

import android.app.Activity
import android.app.Dialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognizerIntent
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.InputDevice
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.AbsListView
import android.widget.BaseAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import android.widget.Toast
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import kotlin.math.abs

/** A 1,440-row virtual ledger: touch to scroll, bezel to step, tap any minute to type or dictate. */
class MinuteActivity : Activity() {
    private lateinit var store: WatchStore
    private lateinit var list: ListView
    private lateinit var dateButton: Button
    private lateinit var status: TextView
    private lateinit var adapter: MinuteAdapter
    private var selected = now()
    private var followingNow = true
    private var editing: Coordinate? = null
    private var editor: EditText? = null
    private var editorDialog: Dialog? = null
    private var displayedEntries = emptyMap<Int, JSONObject>()
    private var displayedPending = emptyMap<Int, JSONObject>()
    private var twelveHourClock = false
    private var categoryColors = emptyMap<String, Int>()
    private var touchBrowsing = false
    private val handler = Handler(Looper.getMainLooper())
    private val ticker = object : Runnable {
        override fun run() {
            val current = now()
            if (followingNow && editing == null && selected != current) {
                val changedDay = selected.dateKey != current.dateKey
                selected = current; render(); centerMinute()
                if (changedDay) WatchTransport.requestDay(this@MinuteActivity, selected.dateKey)
            }
            handler.postDelayed(this, 1000)
        }
    }
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) { render() }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = WatchStore(this)
        savedInstanceState?.let {
            selected = Coordinate(it.getString("date") ?: selected.dateKey, it.getInt("minute", selected.minuteIndex))
            followingNow = it.getBoolean("follow", true)
        }
        window.statusBarColor = Color.BLACK; window.navigationBarColor = Color.BLACK
        val root = column().apply { setPadding(dp(24), dp(WatchLayout.TOP), dp(24), 0); setBackgroundColor(BACKGROUND) }
        val dates = row()
        dateButton = button("", "Choose ledger date") { chooseDate() }
        dates.addView(dateButton, LinearLayout.LayoutParams(0, dp(WatchLayout.HEADER), 1f))
        dates.addView(button("Now", "Return to the current minute") {
            selected = now(); followingNow = true; render(); centerMinute()
            WatchTransport.requestDay(this, selected.dateKey); WatchTransport.synchronize(this, selected.dateKey)
        }, LinearLayout.LayoutParams(dp(42), dp(WatchLayout.HEADER)))
        root.addView(dates)
        status = label("", 10f).apply { setTextColor(MUTED); maxLines = 1; gravity = Gravity.CENTER }
        root.addView(status, LinearLayout.LayoutParams(-1, dp(WatchLayout.STATUS)))
        adapter = MinuteAdapter()
        list = ListView(this).apply {
            divider = null; isVerticalScrollBarEnabled = false; clipToPadding = false
            setPadding(0, 0, 0, dp(30)); setBackgroundColor(BACKGROUND)
            setOnItemClickListener { _, _, position, _ ->
                followingNow = false; selected = Coordinate(selected.dateKey, position); render(); openEditor(selected)
            }
            setOnScrollListener(object : AbsListView.OnScrollListener {
                override fun onScrollStateChanged(view: AbsListView?, state: Int) {
                    if (state == AbsListView.OnScrollListener.SCROLL_STATE_TOUCH_SCROLL) {
                        followingNow = false; touchBrowsing = true
                    } else if (state == AbsListView.OnScrollListener.SCROLL_STATE_IDLE && touchBrowsing) {
                        val middle = list.pointToPosition(list.width / 2, list.height / 2)
                        if (middle in 0..1439) selected = Coordinate(selected.dateKey, middle)
                        touchBrowsing = false; adapter.notifyDataSetChanged()
                    }
                }
                override fun onScroll(view: AbsListView?, first: Int, visible: Int, total: Int) = Unit
            })
            onFocusChangeListener = View.OnFocusChangeListener { _, _ -> Unit }
        }
        list.adapter = adapter
        root.addView(list, LinearLayout.LayoutParams(-1, 0, 1f))
        setContentView(root); render(); list.post { centerMinute() }
        savedInstanceState?.getString("editorText")?.let { text ->
            val target = Coordinate(savedInstanceState.getString("editorDate") ?: selected.dateKey,
                savedInstanceState.getInt("editorMinute", selected.minuteIndex))
            list.post { openEditor(target, text) }
        }
    }

    override fun onStart() {
        super.onStart()
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, IntentFilter(WatchTransport.ACTION_CHANGED), RECEIVER_NOT_EXPORTED)
        else @Suppress("DEPRECATION") registerReceiver(receiver, IntentFilter(WatchTransport.ACTION_CHANGED))
        handler.post(ticker)
        WatchTransport.synchronize(this, selected.dateKey); WatchTransport.requestDay(this, selected.dateKey)
    }
    override fun onStop() {
        handler.removeCallbacks(ticker); unregisterReceiver(receiver); super.onStop()
    }
    override fun onSaveInstanceState(out: Bundle) {
        out.putString("date", selected.dateKey); out.putInt("minute", selected.minuteIndex); out.putBoolean("follow", followingNow)
        editing?.let { out.putString("editorDate", it.dateKey); out.putInt("editorMinute", it.minuteIndex)
            out.putString("editorText", editor?.text?.toString() ?: "") }
        super.onSaveInstanceState(out)
    }
    override fun dispatchGenericMotionEvent(event: MotionEvent): Boolean {
        if (editing == null && event.action == MotionEvent.ACTION_SCROLL &&
            event.isFromSource(InputDevice.SOURCE_ROTARY_ENCODER)) {
            val scroll = event.getAxisValue(MotionEvent.AXIS_SCROLL)
            if (abs(scroll) > 0.01f) {
                moveMinute(if (scroll > 0) -1 else 1)
                list.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                return true
            }
        }
        return super.dispatchGenericMotionEvent(event)
    }

    private fun changeDay(amount: Long) {
        followingNow = false
        selected = Coordinate(LocalDate.parse(selected.dateKey).plusDays(amount).toString(), selected.minuteIndex)
        render(); centerMinute(); WatchTransport.requestDay(this, selected.dateKey)
    }
    private fun moveMinute(amount: Int) {
        followingNow = false; val previousDay = selected.dateKey; selected = selected.move(amount)
        render(); centerMinute()
        if (previousDay != selected.dateKey) WatchTransport.requestDay(this, selected.dateKey)
    }
    private fun centerMinute() {
        list.setSelectionFromTop(selected.minuteIndex, ((list.height - dp(WatchLayout.MINUTE)) / 2).coerceAtLeast(0))
    }
    private fun render() {
        if (!::adapter.isInitialized) return
        val day = store.day(selected.dateKey)
        twelveHourClock = when (day?.optString("clockFormat")) {
            "12h" -> true
            "24h" -> false
            else -> !android.text.format.DateFormat.is24HourFormat(this)
        }
        val categories = day?.optJSONArray("categories")
        categoryColors = (0 until (categories?.length() ?: 0)).map { categories!!.getJSONObject(it) }.associate {
            it.getString("id") to runCatching { Color.parseColor(it.getString("color")) }.getOrDefault(MUTED)
        }
        val entries = day?.optJSONArray("entries")
        displayedEntries = (0 until (entries?.length() ?: 0)).map { entries!!.getJSONObject(it) }
            .associateBy { it.getInt("minuteIndex") }
        displayedPending = store.pendingRecords().filter {
            it.getJSONObject("operation").getString("dateKey") == selected.dateKey
        }.associateBy { it.getJSONObject("operation").getInt("minuteIndex") }
        dateButton.text = LocalDate.parse(selected.dateKey).format(DateTimeFormatter.ofPattern("EEE d MMM"))
        status.text = when {
            displayedPending.values.any { it.optString("status") != "pending" } -> "Review on phone"
            store.pendingRecords().isNotEmpty() -> "Saved · waiting for phone"
            WatchTransport.lastError != null -> "Open phone to sync"
            day == null || day.optBoolean("partial", false) -> "Open phone to load day"
            else -> "Tap a minute to edit"
        }
        adapter.notifyDataSetChanged()
    }
    private fun timeLabel(minute: Int): String {
        if (!twelveHourClock) return "%02d:%02d".format(minute / 60, minute % 60)
        val hour = minute / 60
        return "%d:%02d %s".format(if (hour % 12 == 0) 12 else hour % 12, minute % 60, if (hour < 12) "AM" else "PM")
    }
    private fun categoryColor(id: String): Int {
        return categoryColors[id] ?: MUTED
    }
    private inner class MinuteAdapter : BaseAdapter() {
        override fun getCount() = 1440
        override fun getItem(position: Int): Any = position
        override fun getItemId(position: Int) = position.toLong()
        override fun getView(position: Int, recycled: View?, parent: ViewGroup?): View {
            val cell = recycled as? LinearLayout ?: column().apply {
                setPadding(dp(10), dp(5), dp(10), dp(5))
                addView(label("", 14f).apply { setTypeface(null, Typeface.BOLD) })
                addView(label("", 12f).apply { maxLines = 1; setTextColor(MUTED) })
                layoutParams = AbsListView.LayoutParams(-1, dp(WatchLayout.MINUTE))
            }
            val pending = displayedPending[position]
            val entry = pending?.getJSONObject("operation") ?: displayedEntries[position]
            val time = cell.getChildAt(0) as TextView; val note = cell.getChildAt(1) as TextView
            time.text = timeLabel(position) + if (pending != null) " ·" else ""
            note.text = entry?.optString("text")?.takeIf { it.isNotEmpty() } ?: "Unrecorded"
            cell.background = rounded(if (position == selected.minuteIndex) PANEL else BACKGROUND,
                if (position == selected.minuteIndex) ACCENT else null)
            val color = entry?.optString("categoryId")?.let { categoryColor(it) } ?: MUTED
            time.setTextColor(if (position == selected.minuteIndex) ACCENT else FOREGROUND)
            val swatch = GradientDrawable().apply { setColor(color); cornerRadius = dp(2).toFloat(); setSize(dp(3), dp(13)) }
            time.setCompoundDrawablesWithIntrinsicBounds(swatch, null, null, null)
            time.compoundDrawablePadding = dp(6)
            cell.contentDescription = "${time.text}. ${note.text}. Tap to edit."
            return cell
        }
    }

    private fun openEditor(target: Coordinate, restored: String? = null) {
        editorDialog?.dismiss(); followingNow = false
        val day = store.day(target.dateKey)
        val cached = store.cachedEntry(target.dateKey, target.minuteIndex)
        val pending = store.latest(target.dateKey, target.minuteIndex)
        if (pending != null && pending.optString("status") != "pending" && restored == null) {
            reviewConflict(pending); return
        }
        val original = pending?.getJSONObject("operation") ?: cached
        val known = cached != null || (day != null && !day.optBoolean("partial", false))
        val version = cached?.optString("version")?.takeIf { it.isNotEmpty() && it != "null" } ?: "[null,null]"
        val content = column().apply { setPadding(dp(26), dp(WatchLayout.TOP), dp(26), dp(WatchLayout.EDITOR_BOTTOM)) }
        val body = column()
        val scrolling = android.widget.ScrollView(this).apply { isFillViewport = true; addView(body) }
        content.addView(scrolling, LinearLayout.LayoutParams(-1, 0, 1f))
        body.addView(label("${LocalDate.parse(target.dateKey).format(DateTimeFormatter.ofPattern("d MMM"))} · ${timeLabel(target.minuteIndex)}", 14f)
            .apply { gravity = Gravity.CENTER }, LinearLayout.LayoutParams(-1, dp(WatchLayout.TITLE)))
        val input = EditText(this).apply {
            setText(restored ?: original?.optString("text") ?: ""); setTextColor(FOREGROUND); setHintTextColor(MUTED)
            hint = "What were you doing?"; textSize = 15f; gravity = Gravity.TOP
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES or InputType.TYPE_TEXT_FLAG_MULTI_LINE
            imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_DONE
            setOnEditorActionListener { _, action, _ ->
                if (action == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                    (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(windowToken, 0)
                    clearFocus(); true
                } else false
            }
            filters = arrayOf(InputFilter.LengthFilter(50_000)); setPadding(dp(5), dp(9), dp(5), dp(5))
        }
        body.addView(input, LinearLayout.LayoutParams(-1, dp(WatchLayout.TEXT_FIELD)))
        var chosenCategory: String? = null
        var colorButton: Button? = null
        colorButton = button("Keep color", "Choose activity color") {
            val categories = day?.optJSONArray("categories")
            val choices = (0 until (categories?.length() ?: 0)).map { categories!!.getJSONObject(it) }
                .filter { it.optBoolean("selectable", true) }
            if (choices.isEmpty()) toast("Open Context on your phone to load activity colors.")
            else {
                val picker = column().apply { setPadding(dp(28), dp(25), dp(28), dp(22)) }
                val scroll = android.widget.ScrollView(this); val options = column(); scroll.addView(options)
                picker.addView(label("Activity color", 16f).apply { gravity = Gravity.CENTER })
                picker.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
                val dialog = fullDialog(picker)
                choices.forEach { category -> options.addView(button(category.getString("name"), category.getString("name")) {
                    chosenCategory = category.getString("id"); colorButton?.text = category.getString("name"); dialog.dismiss()
                }.apply { setTextColor(runCatching { Color.parseColor(category.getString("color")) }.getOrDefault(ACCENT)) }) }
                dialog.show()
            }
        }
        val tools = row()
        tools.addView(colorButton, LinearLayout.LayoutParams(0, dp(WatchLayout.INPUT_TOOLS), 1f))
        tools.addView(button("Dictate", "Dictate a note for this selected minute") {
            try {
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, "${target.dateKey} ${timeLabel(target.minuteIndex)}"), SPEECH)
            } catch (_: android.content.ActivityNotFoundException) { toast("Dictation is unavailable. Tap the note to type.") }
        }, LinearLayout.LayoutParams(0, dp(WatchLayout.INPUT_TOOLS), 1f))
        body.addView(tools)
        val actions = row()
        actions.addView(button("Cancel", "Cancel minute edit") { editorDialog?.dismiss() }, LinearLayout.LayoutParams(0, dp(WatchLayout.ACTIONS), 1f))
        actions.addView(button("Save", "Save this minute on the watch") {
            try {
                val text = input.text.toString().trim()
                if (pending == null || text != pending.getJSONObject("operation").getString("text") || chosenCategory != null) {
                    store.save(target, text, chosenCategory, known, if (known) version else null)
                }
                editorDialog?.dismiss(); render(); WatchTransport.sendPending(this)
            } catch (_: Exception) { toast("Could not save. Keep this editor open and try again.") }
        }, LinearLayout.LayoutParams(0, dp(WatchLayout.ACTIONS), 1f))
        content.addView(actions)
        editing = target; editor = input
        editorDialog = fullDialog(content).apply {
            setOnDismissListener { editing = null; editor = null; editorDialog = null }
            show()
        }
    }
    private fun reviewConflict(record: JSONObject) {
        val operation = record.getJSONObject("operation")
        val content = column().apply { setPadding(dp(28), dp(25), dp(28), dp(26)) }
        content.addView(label("Review on phone", 15f).apply { gravity = Gravity.CENTER; setTextColor(WARNING) })
        val details = android.widget.ScrollView(this)
        details.addView(label("Open Context on your phone to resolve this. Your watch note stays saved.\n\n${record.optString("message", "The phone changed this minute.")}\n\nWatch: ${operation.getString("text")}\n\nPhone: ${record.optJSONObject("currentEntry")?.optString("text") ?: "Unrecorded"}", 12f))
        content.addView(details, LinearLayout.LayoutParams(-1, 0, 1f))
        val dialog = fullDialog(content)
        content.addView(button("Back", "Keep both versions and return to the ledger") { dialog.dismiss() },
            LinearLayout.LayoutParams(-1, dp(32)))
        dialog.show()
    }
    @Deprecated("Uses the system speech activity for compatibility with Wear OS 3 and later")
    override fun onActivityResult(request: Int, result: Int, data: Intent?) {
        super.onActivityResult(request, result, data)
        if (request == SPEECH && result == RESULT_OK && editing != null) {
            data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let {
                editor?.setText(it); editor?.setSelection(editor?.text?.length ?: 0)
            }
        }
    }
    private fun chooseDate() {
        val content = column().apply { setPadding(dp(26), dp(WatchLayout.TOP), dp(26), dp(WatchLayout.EDITOR_BOTTOM)) }
        val body = column()
        val scrolling = android.widget.ScrollView(this).apply { isFillViewport = true; addView(body) }
        content.addView(scrolling, LinearLayout.LayoutParams(-1, 0, 1f))
        body.addView(label("Choose a day", 15f).apply { gravity = Gravity.CENTER })
        body.addView(label("YYYY-MM-DD", 11f).apply { gravity = Gravity.CENTER; setTextColor(MUTED) })
        val input = EditText(this).apply { setText(selected.dateKey); setTextColor(FOREGROUND); textSize = 17f
            isSingleLine = true; gravity = Gravity.CENTER; inputType = InputType.TYPE_CLASS_DATETIME or InputType.TYPE_DATETIME_VARIATION_DATE }
        body.addView(input, LinearLayout.LayoutParams(-1, dp(50)))
        val dialog = fullDialog(content)
        val days = row()
        days.addView(button("‹ Day", "Open the previous ledger day") { changeDay(-1); dialog.dismiss() },
            LinearLayout.LayoutParams(0, dp(32), 1f))
        days.addView(button("Day ›", "Open the next ledger day") { changeDay(1); dialog.dismiss() },
            LinearLayout.LayoutParams(0, dp(32), 1f))
        body.addView(days)
        val actions = row()
        actions.addView(button("Cancel", "Cancel date selection") { dialog.dismiss() },
            LinearLayout.LayoutParams(0, dp(WatchLayout.ACTIONS), 1f))
        actions.addView(button("Go", "Open the entered ledger date") {
            try {
                val date = LocalDate.parse(input.text.toString().trim())
                selected = Coordinate(date.toString(), selected.minuteIndex); followingNow = false
                dialog.dismiss(); render(); centerMinute(); WatchTransport.requestDay(this, selected.dateKey)
            } catch (_: Exception) { input.error = "Use YYYY-MM-DD" }
        }, LinearLayout.LayoutParams(0, dp(WatchLayout.ACTIONS), 1f))
        content.addView(actions)
        dialog.show()
    }
    private fun fullDialog(content: View): Dialog = Dialog(this).apply {
        requestWindowFeature(Window.FEATURE_NO_TITLE); setContentView(content)
        window?.setBackgroundDrawableResource(android.R.color.black)
        window?.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE or
            android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
        setOnShowListener { window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
    }
    private fun column() = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(BACKGROUND) }
    private fun row() = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
    private fun label(value: String, size: Float) = TextView(this).apply {
        text = value; textSize = size; setTextColor(FOREGROUND); typeface = Typeface.create("sans-serif", Typeface.NORMAL)
    }
    private fun button(value: String, description: String, action: () -> Unit) = Button(this).apply {
        text = value; textSize = 11f; isAllCaps = false; contentDescription = description
        minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0
        setPadding(dp(2), 0, dp(2), 0); setTextColor(ACCENT); background = rounded(PANEL)
        setOnClickListener { action() }
    }
    private fun rounded(color: Int, stroke: Int? = null) = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE; cornerRadius = dp(13).toFloat(); setColor(color)
        if (stroke != null) setStroke(dp(1), stroke)
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun toast(message: String) { Toast.makeText(this, message, Toast.LENGTH_LONG).show() }
    companion object {
        private const val SPEECH = 100
        private val BACKGROUND = Color.parseColor("#08090B")
        private val PANEL = Color.parseColor("#202024")
        private val FOREGROUND = Color.parseColor("#F3EFF7")
        private val ACCENT = Color.parseColor("#C4B8E7")
        private val MUTED = Color.parseColor("#A8A3AF")
        private val WARNING = Color.parseColor("#E6B585")
        private fun now(): Coordinate = LocalDateTime.now().let { Coordinate(it.toLocalDate().toString(), it.hour * 60 + it.minute) }
    }
}
