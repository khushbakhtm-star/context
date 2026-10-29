package com.context.minuteledger.wear

import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.time.LocalDateTime

/** A visible, user-initiated note session. Phrase pauses never save or close the note. */
class WatchDictationDialog(
    private val activity: Activity,
    private val target: Coordinate,
    private val twelveHourClock: Boolean,
    private val isCurrent: () -> Boolean,
    private val onConfirmed: (String) -> Unit,
    private val onClosed: (Boolean, String?) -> Unit,
) {
    private val handler = Handler(Looper.getMainLooper())
    private val guard = WatchDictationRunGuard()
    private val note = WatchDictationNote()
    private var active = true
    private var recognizer: SpeechRecognizer? = null
    private var backend = WatchSpeechBackend.UNAVAILABLE
    private var systemAttempted = false
    private val onDevice = Build.VERSION.SDK_INT >= 31 && runCatching {
        SpeechRecognizer.isOnDeviceRecognitionAvailable(activity)
    }.getOrDefault(false)
    private val system = runCatching { SpeechRecognizer.isRecognitionAvailable(activity) }.getOrDefault(false)
    private val clock = label("", 10f).apply { setTypeface(Typeface.MONOSPACE, Typeface.NORMAL); gravity = Gravity.CENTER }
    private val message = label("", 11f).apply { gravity = Gravity.CENTER; setTextColor(MUTED) }
    private val words = label("", 14f)
    private val done: Button = button("Done", "Save the displayed dictation and return to your minutes") {
        // Done is the sole confirmation. Invalidate callbacks before stopping the microphone.
        note.confirmDisplayed()?.let { close(confirmed = it) }
    }
    private val continueButton = button("Continue", "Continue dictating without losing the displayed words") { start(backend == WatchSpeechBackend.SYSTEM) }
    private val dialog: Dialog
    private val nextPhrase = Runnable {
        if (active && isCurrent()) start(backend == WatchSpeechBackend.SYSTEM)
    }
    private val ticker = object : Runnable {
        override fun run() {
            if (!active) return
            clock.text = "Now ${WatchDictationPolicy.clock(LocalDateTime.now(), twelveHourClock)}"
            handler.postDelayed(this, 1000)
        }
    }

    init {
        val root = column().apply { setPadding(dp(24), dp(20), dp(24), dp(22)) }
        root.addView(clock, LinearLayout.LayoutParams(-1, dp(18)))
        root.addView(label(WatchDictationPolicy.minuteLabel(target, twelveHourClock), if (twelveHourClock) 10f else 11f).apply { gravity = Gravity.CENTER },
            LinearLayout.LayoutParams(-1, dp(22)))
        val body = column()
        body.addView(message); body.addView(words)
        continueButton.visibility = View.GONE
        body.addView(continueButton, LinearLayout.LayoutParams(-1, dp(32)))
        root.addView(ScrollView(activity).apply { isFillViewport = true; addView(body) }, LinearLayout.LayoutParams(-1, 0, 1f))
        val actions = LinearLayout(activity).apply { gravity = Gravity.CENTER }
        actions.addView(button("Type", "Stop dictation and type in the same minute") { close(type = true) },
            LinearLayout.LayoutParams(0, dp(32), 1f))
        actions.addView(done, LinearLayout.LayoutParams(0, dp(32), 1f))
        root.addView(actions)
        dialog = Dialog(activity).apply {
            requestWindowFeature(Window.FEATURE_NO_TITLE); setContentView(root)
            window?.setBackgroundDrawableResource(android.R.color.black)
            setOnShowListener { window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT) }
            setOnDismissListener { close() }
        }
    }

    fun show() {
        if (!active || !isCurrent()) { close(); return }
        dialog.show(); handler.post(ticker)
        start(false)
    }

    fun cancel(preserveDraft: Boolean = false) = close(preserveDraft = preserveDraft)

    private fun start(preferSystem: Boolean) {
        if (!active || !isCurrent()) { close(); return }
        handler.removeCallbacks(nextPhrase)
        stopRecognizer()
        backend = WatchDictationPolicy.backend(Build.VERSION.SDK_INT, onDevice, system, preferSystem)
        if (backend == WatchSpeechBackend.UNAVAILABLE) { failed(WatchSpeechFailure.UNAVAILABLE); return }
        if (backend == WatchSpeechBackend.SYSTEM) systemAttempted = true
        val token = guard.begin()
        val current = {
            active && guard.accepts(token) && isCurrent()
        }
        note.beginPhrase()
        words.text = note.text
        try {
            val speech = if (backend == WatchSpeechBackend.ON_DEVICE && Build.VERSION.SDK_INT >= 31)
                SpeechRecognizer.createOnDeviceSpeechRecognizer(activity)
            else SpeechRecognizer.createSpeechRecognizer(activity)
            recognizer = speech
            speech.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    if (current()) message.text = if (backend == WatchSpeechBackend.ON_DEVICE) "Listening on watch…" else "Listening with system speech…"
                }
                override fun onBeginningOfSpeech() = Unit
                override fun onRmsChanged(rmsdB: Float) = Unit
                override fun onBufferReceived(buffer: ByteArray?) = Unit
                override fun onEndOfSpeech() {
                    if (current()) { message.text = "Keeping your words…"; doneState("Done", note.text.isNotBlank()) }
                }
                override fun onError(error: Int) {
                    if (!current()) return
                    failed(when (error) {
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER -> WatchSpeechFailure.NETWORK
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> WatchSpeechFailure.MODEL
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS, SpeechRecognizer.ERROR_AUDIO -> WatchSpeechFailure.MICROPHONE
                        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> WatchSpeechFailure.EMPTY
                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> WatchSpeechFailure.BUSY
                        else -> WatchSpeechFailure.UNAVAILABLE
                    })
                }
                override fun onResults(results: Bundle?) {
                    if (!current()) return
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    if (text.isNullOrBlank() || !note.acceptPhrase(text)) { failed(WatchSpeechFailure.EMPTY); return }
                    stopRecognizer()
                    words.text = note.text; doneState("Done", true)
                    message.text = "Words kept. Continue speaking, or tap Done."
                    // Some providers finalize on a breath. Start a new phrase only while this
                    // same visible note session is current; never restart after Done or dismissal.
                    handler.postDelayed(nextPhrase, 200)
                }
                override fun onPartialResults(partialResults: Bundle?) {
                    if (!current()) return
                    val partial = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    if (partial != null && note.preview(partial)) {
                        words.text = note.text; doneState("Done", note.text.isNotBlank())
                    }
                }
                override fun onEvent(eventType: Int, params: Bundle?) = Unit
            })
            continueButton.visibility = View.GONE
            doneState("Done", note.text.isNotBlank())
            message.text = if (backend == WatchSpeechBackend.ON_DEVICE) "Starting on-watch speech…" else "System speech may require internet."
            speech.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true))
        } catch (_: SecurityException) { if (current()) failed(WatchSpeechFailure.MICROPHONE) }
        catch (_: Exception) { if (current()) failed(WatchSpeechFailure.UNAVAILABLE) }
    }

    private fun failed(reason: WatchSpeechFailure) {
        if (!active) return
        handler.removeCallbacks(nextPhrase)
        stopRecognizer()
        if (isCurrent() && WatchDictationPolicy.retryWithSystem(backend, reason, system, systemAttempted)) {
            start(true)
            return
        }
        message.text = WatchDictationPolicy.failure(reason, backend == WatchSpeechBackend.ON_DEVICE) +
            if (note.text.isNotBlank()) " Your words are kept. Tap Done to save, Continue, or Type." else ""
        words.text = note.text
        continueButton.visibility = if (backend != WatchSpeechBackend.UNAVAILABLE) View.VISIBLE else View.GONE
        doneState("Done", note.text.isNotBlank())
    }
    private fun stopRecognizer() {
        guard.invalidate()
        val previous = recognizer; recognizer = null
        runCatching { previous?.cancel() }; runCatching { previous?.destroy() }
    }
    private fun close(confirmed: String? = null, type: Boolean = false, preserveDraft: Boolean = false) {
        if (!active) return
        val partial = if (type || preserveDraft) words.text?.toString() else null
        active = false; guard.close(); stopRecognizer(); handler.removeCallbacks(ticker); handler.removeCallbacks(nextPhrase)
        dialog.setOnDismissListener(null); dialog.dismiss()
        if (confirmed != null) onConfirmed(confirmed) else onClosed(type, partial)
    }
    private fun doneState(text: String, enabled: Boolean) { done.text = text; done.isEnabled = enabled }
    private fun column() = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(BACKGROUND) }
    private fun label(text: String, size: Float) = TextView(activity).apply { this.text = text; textSize = size; setTextColor(FOREGROUND) }
    private fun button(text: String, description: String, action: () -> Unit) = Button(activity).apply {
        this.text = text; textSize = 11f; isAllCaps = false; contentDescription = description
        minWidth = 0; minimumWidth = 0; minHeight = 0; minimumHeight = 0; setPadding(0, 0, 0, 0)
        setTextColor(ACCENT); setOnClickListener { action() }
    }
    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    companion object {
        private val BACKGROUND = Color.parseColor("#08090B")
        private val FOREGROUND = Color.parseColor("#F3EFF7")
        private val MUTED = Color.parseColor("#A8A3AF")
        private val ACCENT = Color.parseColor("#C4B8E7")
    }
}
