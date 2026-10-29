package com.context.minuteledger.wear

import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

enum class WatchSpeechBackend { ON_DEVICE, SYSTEM, UNAVAILABLE }
enum class WatchSpeechFailure { NETWORK, MODEL, MICROPHONE, EMPTY, BUSY, UNAVAILABLE }

/** Clock display never retargets the immutable minute being recorded. */
object WatchDictationPolicy {
    fun backend(api: Int, onDeviceAvailable: Boolean, systemAvailable: Boolean,
        preferSystem: Boolean = false): WatchSpeechBackend = when {
        preferSystem && systemAvailable -> WatchSpeechBackend.SYSTEM
        !preferSystem && api >= 31 && onDeviceAvailable -> WatchSpeechBackend.ON_DEVICE
        systemAvailable -> WatchSpeechBackend.SYSTEM
        else -> WatchSpeechBackend.UNAVAILABLE
    }
    /** Dictate authorizes the available provider; an unusable on-device model may fall back once. */
    fun retryWithSystem(failedBackend: WatchSpeechBackend, failure: WatchSpeechFailure,
        systemAvailable: Boolean, systemAttempted: Boolean): Boolean =
        failedBackend == WatchSpeechBackend.ON_DEVICE && systemAvailable && !systemAttempted &&
            failure in setOf(WatchSpeechFailure.MODEL, WatchSpeechFailure.UNAVAILABLE)
    fun clock(current: LocalDateTime, twelveHour: Boolean = false): String = current.format(
        DateTimeFormatter.ofPattern(if (twelveHour) "h:mm:ss a" else "HH:mm:ss", Locale.ROOT))
    fun minuteLabel(target: Coordinate, twelveHour: Boolean = false): String {
        val current = LocalDateTime.parse("${target.dateKey}T00:00:00").plusMinutes(target.minuteIndex.toLong())
        val time = current.format(DateTimeFormatter.ofPattern(if (twelveHour) "h:mm a" else "HH:mm", Locale.ROOT))
        return "Note ${target.dateKey} $time"
    }
    /** Unconfirmed words may become an editable draft, never a saved operation. */
    fun preservedDraft(pending: SpeechSession?, requestCode: Int, editor: EditorSession?,
        originalText: String, currentText: String?, partial: String?): String? {
        if (!SpeechSessionGuard.accepts(pending, requestCode, editor) || currentText != originalText ||
            partial == null || partial.length > DictationSavePolicy.MAX_TEXT_LENGTH) return null
        return partial.trim().takeIf { it.isNotEmpty() }
    }
    fun failure(kind: WatchSpeechFailure, onDevice: Boolean): String = when (kind) {
        WatchSpeechFailure.MODEL -> if (onDevice) "Offline speech is unavailable for this language on this watch. Tap Type or retry."
            else "This system speech provider cannot use the selected language. Tap Type, or change the watch speech language."
        WatchSpeechFailure.NETWORK -> if (onDevice) "On-watch speech could not finish. Tap Type or retry."
            else "System speech could not connect. It may need internet on the watch or paired phone. Tap Type or retry."
        WatchSpeechFailure.MICROPHONE -> "Microphone access is unavailable. Tap Type, or allow microphone access in watch Settings."
        WatchSpeechFailure.EMPTY -> "No words were confirmed. Tap Type or try speaking again."
        WatchSpeechFailure.BUSY -> "Speech recognition is busy. Tap Type or retry."
        WatchSpeechFailure.UNAVAILABLE -> "Speech recognition is unavailable. Tap Type or retry."
    }
}

/** A cancelled/retried recognizer cannot deliver its late callback to a new run. */
class WatchDictationRunGuard {
    private var generation = 0
    private var open = true
    fun begin(): Int { check(open); generation += 1; return generation }
    fun accepts(token: Int): Boolean = open && token == generation
    fun invalidate() { generation += 1 }
    fun close() { open = false; generation += 1 }
}

/** Phrase boundaries are not note boundaries. Only the user's Done action confirms this draft. */
class WatchDictationNote {
    private var completed = ""
    private var partial = ""
    val text: String get() = join(completed, partial)
    fun beginPhrase() {
        // A retry retains words shown before an interruption, without saving them.
        completed = text; partial = ""
    }
    fun preview(value: String): Boolean {
        val next = value.trim()
        if (join(completed, next).length > DictationSavePolicy.MAX_TEXT_LENGTH) return false
        partial = next; return true
    }
    fun acceptPhrase(value: String): Boolean {
        val next = value.trim()
        if (next.isEmpty() || join(completed, next).length > DictationSavePolicy.MAX_TEXT_LENGTH) return false
        completed = join(completed, next); partial = ""; return true
    }
    fun confirmDisplayed(): String? = text.takeIf { it.isNotBlank() && it.length <= DictationSavePolicy.MAX_TEXT_LENGTH }
    private fun join(first: String, second: String): String = when {
        first.isEmpty() -> second
        second.isEmpty() -> first
        else -> "$first $second"
    }
}
