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
    private var editorSession: EditorSession? = null
    private var restoringEditor = false
    private data class RestoredEditor(val session: EditorSession, val text: String, val initialText: String,
        val autoNow: Boolean, val inputFocused: Boolean)
    private var pendingRestore: RestoredEditor? = null
    private var pendingSpeech: SpeechSession? = null
    private var nextSpeechRequest = SPEECH
    private var preserveSpeechResume = false
    private val pickers = mutableSetOf<Dialog>()
    private var deferredNow = false
    private var visible = false
    private var resumed = false
    private var wasStopped = false
    private var editorAutoNow = false
    private var editorInitialText = ""
    private var launchGeneration = 0
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
        restoringEditor = savedInstanceState?.containsKey("editorText") == true
        deferredNow = savedInstanceState?.getBoolean("deferredNow", false) ?: false
        nextSpeechRequest = savedInstanceState?.getInt("nextSpeechRequest", SPEECH) ?: SPEECH
        preserveSpeechResume = savedInstanceState?.getBoolean("preserveSpeechResume", false) ?: false
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
            applyLaunch(LaunchTrigger.LAUNCHER_OR_TILE)
        }, LinearLayout.LayoutParams(dp(42), dp(WatchLayout.HEADER)))
        root.addView(dates)
        status = label("", 10f).apply { setTextColor(MUTED); maxLines = 1; gravity = Gravity.CENTER }
        root.addView(status, LinearLayout.LayoutParams(-1, dp(WatchLayout.STATUS)))
        adapter = MinuteAdapter()
        list = ListView(this).apply {
            divider = null; isVerticalScrollBarEnabled = false; clipToPadding = false
            setPadding(0, 0, 0, dp(30)); setBackgroundColor(BACKGROUND)
            setOnItemClickListener { _, _, position, _ ->
                cancelPendingLaunch()
                followingNow = false; selected = Coordinate(selected.dateKey, position); render(); openEditor(selected)
            }
            setOnScrollListener(object : AbsListView.OnScrollListener {
                override fun onScrollStateChanged(view: AbsListView?, state: Int) {
                    if (state == AbsListView.OnScrollListener.SCROLL_STATE_TOUCH_SCROLL) {
                        cancelPendingLaunch()
                        followingNow = false; touchBrowsing = true
                    } else if (state == AbsListView.OnScrollListener.SCROLL_STATE_IDLE && touchBrowsing) {
                        val middle = list.pointToPosition(list.width / 2, list.height / 2)
                        if (middle in 0..1439) selected = Coordinate(selected.dateKey, middle)
                        touchBrowsing = false; this@MinuteActivity.adapter.notifyDataSetChanged()
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
            val session = EditorSession(target, savedInstanceState.getBoolean("editorBaseKnown", false),
                savedInstanceState.getString("editorExpectedVersion"), savedInstanceState.getString("editorCategory"),
                savedInstanceState.getString("editorPendingId"),
                savedInstanceState.getString("editorSessionId") ?: java.util.UUID.randomUUID().toString(),
                savedInstanceState.getString("editorPendingText"), savedInstanceState.getString("editorPendingCategory"))
            pendingRestore = RestoredEditor(session, text, savedInstanceState.getString("editorInitialText") ?: text,
                savedInstanceState.getBoolean("editorAutoNow", false), savedInstanceState.getBoolean("editorInputFocused", false))
            editorSession = session; editing = target
            if (savedInstanceState.containsKey("speechRequest")) {
                val speech = SpeechSession(savedInstanceState.getInt("speechRequest"),
                    savedInstanceState.getString("speechSessionId") ?: session.sessionId, target)
                if (SpeechSessionGuard.accepts(speech, speech.requestCode, session)) pendingSpeech = speech
            }
        }
    }

    override fun onStart() {
        super.onStart()
        visible = true
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, IntentFilter(WatchTransport.ACTION_CHANGED), RECEIVER_NOT_EXPORTED)
        else @Suppress("DEPRECATION") registerReceiver(receiver, IntentFilter(WatchTransport.ACTION_CHANGED))
        handler.post(ticker)
        WatchTransport.synchronize(this, selected.dateKey); WatchTransport.requestDay(this, selected.dateKey)
    }
    override fun onStop() {
        visible = false; wasStopped = true; launchGeneration++
        handler.removeCallbacks(ticker); unregisterReceiver(receiver); super.onStop()
    }
    override fun onResume() {
        super.onResume(); resumed = true
        if (wasStopped && !preserveSpeechResume && editor?.hasFocus() != true) discardPristineNowEditor()
        preserveSpeechResume = false
        wasStopped = false
        if (pendingRestore != null) list.post { restoreEditor() }
        applyLaunch(LaunchTrigger.ON_START)
    }
    override fun onPause() {
        resumed = false; launchGeneration++; super.onPause()
    }
    override fun onDestroy() {
        visible = false; resumed = false; launchGeneration++
        editorDialog?.dismiss(); pickers.toList().forEach { it.dismiss() }
        super.onDestroy()
    }
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == RECORD_NOW || intent.getStringExtra(LAUNCH_ACTION) == RECORD_NOW ||
            intent.action == Intent.ACTION_MAIN && intent.hasCategory(Intent.CATEGORY_LAUNCHER)) {
            discardPristineNowEditor()
            applyLaunch(LaunchTrigger.LAUNCHER_OR_TILE)
        }
    }
    override fun onSaveInstanceState(out: Bundle) {
        out.putString("date", selected.dateKey); out.putInt("minute", selected.minuteIndex); out.putBoolean("follow", followingNow)
        out.putBoolean("deferredNow", deferredNow); out.putInt("nextSpeechRequest", nextSpeechRequest)
        out.putBoolean("preserveSpeechResume", preserveSpeechResume)
        editing?.let { out.putString("editorDate", it.dateKey); out.putInt("editorMinute", it.minuteIndex)
            out.putString("editorText", editor?.text?.toString() ?: pendingRestore?.text ?: "") }
        editorSession?.let {
            out.putBoolean("editorBaseKnown", it.baseKnown); out.putString("editorExpectedVersion", it.expectedVersion)
            out.putString("editorCategory", it.chosenCategory); out.putString("editorPendingId", it.pendingOperationId)
            out.putString("editorSessionId", it.sessionId)
            out.putString("editorPendingText", it.pendingText); out.putString("editorPendingCategory", it.pendingCategory)
        }
        out.putString("editorInitialText", pendingRestore?.initialText ?: editorInitialText)
        out.putBoolean("editorAutoNow", pendingRestore?.autoNow ?: editorAutoNow)
        out.putBoolean("editorInputFocused", pendingRestore?.inputFocused ?: (editor?.hasFocus() == true))
        pendingSpeech?.let { out.putInt("speechRequest", it.requestCode); out.putString("speechSessionId", it.editorSessionId) }
        super.onSaveInstanceState(out)
    }
    private fun restoreEditor() {
        val saved = pendingRestore ?: return
        if (!visible || !resumed || isFinishing || isDestroyed) return
        openEditor(saved.session.coordinate, saved.text, saved.session, saved.autoNow, saved.initialText, saved.inputFocused)
        pendingRestore = null; restoringEditor = false
    }
    private fun discardPristineNowEditor() {
        if (!LaunchPolicy.mayReplacePristineAutoEditor(editorAutoNow, editor?.text?.toString(), editorInitialText,
            editorSession?.chosenCategory != null, LaunchState(editing != null, restoringEditor,
                pendingSpeech != null, pickers.isNotEmpty(), deferredNow))) return
        val previous = editorDialog ?: return
        // Clear ownership first: a queued old onDismiss must not erase the next editor.
        editorDialog = null; editor = null; editing = null; editorSession = null
        previous.dismiss()
    }
    private fun cancelPendingLaunch() { launchGeneration++; deferredNow = false }
    private fun applyLaunch(trigger: LaunchTrigger) {
        val decision = LaunchPolicy.decide(trigger, LaunchState(editing != null, restoringEditor,
            pendingSpeech != null, pickers.isNotEmpty(), deferredNow))
        deferredNow = decision.deferredNow
        if (!decision.resetToNow) return
        // Retain this request if backgrounding or an editor/picker delays its posted work.
        deferredNow = true
        val generation = ++launchGeneration
        list.post {
            if (!visible || !resumed || isFinishing || isDestroyed || generation != launchGeneration ||
                editing != null || restoringEditor || pendingSpeech != null || pickers.isNotEmpty()) return@post
            selected = decision.target(selected, ::now); followingNow = true
            deferredNow = false
            render(); centerMinute()
            // Show the cached editor immediately; requesting the phone never gates entry.
            openEditor(selected, autoNow = true)
            WatchTransport.requestDay(this, selected.dateKey); WatchTransport.synchronize(this, selected.dateKey)
        }
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
        cancelPendingLaunch()
        followingNow = false
        selected = Coordinate(LocalDate.parse(selected.dateKey).plusDays(amount).toString(), selected.minuteIndex)
        render(); centerMinute(); WatchTransport.requestDay(this, selected.dateKey)
    }
    private fun moveMinute(amount: Int) {
        cancelPendingLaunch()
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

    private fun openEditor(target: Coordinate, restored: String? = null, restoredSession: EditorSession? = null,
        autoNow: Boolean = false, restoredInitialText: String? = null, restoreInputFocus: Boolean = false) {
        editorDialog?.dismiss(); followingNow = false
        val day = store.day(target.dateKey)
        val cached = store.cachedEntry(target.dateKey, target.minuteIndex)
        val pending = store.latest(target.dateKey, target.minuteIndex)
        if (pending != null && pending.optString("status") != "pending" && restored == null) {
            reviewConflict(pending); return
        }
        val pendingOperation = pending?.getJSONObject("operation")
        val original = pendingOperation ?: cached
        val known = cached != null || (day != null && !day.optBoolean("partial", false))
        val version = cached?.optString("version")?.takeIf { it.isNotEmpty() && it != "null" } ?: "[null,null]"
        val pendingVersion = pendingOperation?.optString("expectedVersion")?.takeUnless { it.isEmpty() || it == "null" }
        val pendingCategory = pendingOperation?.optString("categoryId")?.takeUnless { it.isEmpty() || it == "null" }
        var session = restoredSession ?: if (pendingOperation != null) EditorSession(target,
            pendingOperation.optBoolean("baseKnown", false), pendingVersion, pendingCategory,
            pendingOperation.optString("operationId"), pendingText = pendingOperation.getString("text"),
            pendingCategory = pendingCategory)
        else EditorSession(target, known, if (known) version else null)
        editorSession = session
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
        editorAutoNow = autoNow; editorInitialText = restoredInitialText ?: input.text.toString()
        body.addView(input, LinearLayout.LayoutParams(-1, dp(WatchLayout.TEXT_FIELD)))
        var colorButton: Button? = null
        val chosenName = day?.optJSONArray("categories")?.let { categories ->
            (0 until categories.length()).map { categories.getJSONObject(it) }
                .firstOrNull { it.optString("id") == session.chosenCategory }?.optString("name")
        }
        colorButton = button(chosenName ?: "Keep color", "Choose activity color") {
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
                    session = session.copy(chosenCategory = category.getString("id")); editorSession = session
                    colorButton?.text = category.getString("name"); dialog.dismiss()
                }.apply { setTextColor(runCatching { Color.parseColor(category.getString("color")) }.getOrDefault(ACCENT)) }) }
                showPicker(dialog)
            }
        }
        val tools = row()
        tools.addView(colorButton, LinearLayout.LayoutParams(0, dp(WatchLayout.INPUT_TOOLS), 1f))
        tools.addView(button("Dictate", "Dictate a note for this selected minute") {
            try {
                val request = nextSpeechRequest
                nextSpeechRequest = if (request >= 65535) SPEECH else request + 1
                pendingSpeech = SpeechSession(request, session.sessionId, target)
                @Suppress("DEPRECATION")
                startActivityForResult(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_PROMPT, "${target.dateKey} ${timeLabel(target.minuteIndex)}"), request)
            } catch (_: android.content.ActivityNotFoundException) {
                pendingSpeech = null; toast("Dictation is unavailable. Tap the note to type.")
            }
        }, LinearLayout.LayoutParams(0, dp(WatchLayout.INPUT_TOOLS), 1f))
        body.addView(tools)
        val actions = row()
        actions.addView(button("Cancel", "Cancel minute edit") { editorDialog?.dismiss() }, LinearLayout.LayoutParams(0, dp(WatchLayout.ACTIONS), 1f))
        actions.addView(button("Save", "Save this minute on the watch") {
            try {
                val text = input.text.toString().trim()
                if (session.needsSave(text)) {
                    store.save(session.coordinate, text, session.chosenCategory, session.baseKnown, session.expectedVersion)
                }
                editorDialog?.dismiss(); render(); WatchTransport.sendPending(this)
            } catch (_: Exception) { toast("Could not save. Keep this editor open and try again.") }
        }, LinearLayout.LayoutParams(0, dp(WatchLayout.ACTIONS), 1f))
        content.addView(actions)
        editing = target; editor = input
        val dialog = fullDialog(content)
        editorDialog = dialog
        dialog.setOnDismissListener {
            if (editorDialog === dialog && editorSession?.sessionId == session.sessionId) {
                editing = null; editor = null; editorDialog = null; editorSession = null; pendingSpeech = null
                if (visible && !isChangingConfigurations) applyLaunch(LaunchTrigger.EDITOR_CLOSED)
            }
        }
        dialog.show()
        if (autoNow && !restoreInputFocus) { body.isFocusableInTouchMode = true; body.requestFocus() }
        else if (restoreInputFocus) input.requestFocus()
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
        showPicker(dialog)
    }
    @Deprecated("Uses the system speech activity for compatibility with Wear OS 3 and later")
    override fun onActivityResult(request: Int, result: Int, data: Intent?) {
        super.onActivityResult(request, result, data)
        if (!SpeechSessionGuard.accepts(pendingSpeech, request, editorSession)) return
        preserveSpeechResume = !resumed
        pendingSpeech = null
        if (result == RESULT_OK) {
            data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()?.let { text ->
                val restore = pendingRestore
                if (restore != null) pendingRestore = restore.copy(text = text)
                else { editor?.setText(text); editor?.setSelection(editor?.text?.length ?: 0) }
            }
        }
    }
    private fun chooseDate() {
        cancelPendingLaunch()
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
                cancelPendingLaunch()
                selected = Coordinate(date.toString(), selected.minuteIndex); followingNow = false
                dialog.dismiss(); render(); centerMinute(); WatchTransport.requestDay(this, selected.dateKey)
            } catch (_: Exception) { input.error = "Use YYYY-MM-DD" }
        }, LinearLayout.LayoutParams(0, dp(WatchLayout.ACTIONS), 1f))
        content.addView(actions)
        showPicker(dialog)
    }
    private fun showPicker(dialog: Dialog) {
        pickers.add(dialog)
        dialog.setOnDismissListener {
            pickers.remove(dialog)
            if (visible && !isChangingConfigurations) applyLaunch(LaunchTrigger.EDITOR_CLOSED)
        }
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
        private const val LAUNCH_ACTION = "com.context.minuteledger.action"
        private const val RECORD_NOW = "com.context.minuteledger.action.RECORD_NOW"
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
