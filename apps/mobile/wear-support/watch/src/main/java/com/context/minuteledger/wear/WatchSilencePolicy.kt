package com.context.minuteledger.wear

enum class WatchSilenceAction { NONE, STOP_LISTENING, FINISH }

/** Monotonic silence, independent of wall-clock minute changes and provider result latency. */
class WatchSilencePolicy(startedAtMs: Long, delaySeconds: Int = DEFAULT_DELAY_SECONDS) {
    private var delayMs = normalizeDelay(delaySeconds) * 1000L
    private var quietSince = startedAtMs
    private var speaking = false
    private var phraseEnded = false
    private var awaitingFinal = false
    private var flushDue: Long? = null
    private var armed = true
    private var closed = false
    val isArmed: Boolean get() = armed && !closed
    val canListen: Boolean get() = armed && !closed && flushDue == null

    fun providerStarted() {
        if (!canListen) return
        phraseEnded = false; awaitingFinal = true
    }
    fun began(now: Long) {
        if (!armed || closed) return
        speaking = true; phraseEnded = false; quietSince = now; flushDue = null
    }
    /** Call only for a changed text hypothesis, never RMS, buffers or duplicate callbacks. */
    fun changedPartial(now: Long) {
        if (!armed || closed || phraseEnded) return
        quietSince = now; flushDue = null
        speaking = true
    }
    fun ended(now: Long) {
        if (!armed || closed) return
        if (speaking) quietSince = now
        speaking = false; phraseEnded = true
    }
    fun providerFinished(now: Long) {
        if (!armed || closed) return
        // If a provider omits onEndOfSpeech, completion is our first safe end signal.
        // Otherwise the final result must not extend the silence that already elapsed.
        if (speaking) quietSince = now
        speaking = false; phraseEnded = true; awaitingFinal = false
    }
    fun hardFailure() = pause()
    fun pause() {
        armed = false; speaking = false; awaitingFinal = false; flushDue = null
    }
    fun resume(now: Long, delaySeconds: Int = DEFAULT_DELAY_SECONDS) {
        if (closed) return
        delayMs = normalizeDelay(delaySeconds) * 1000L
        quietSince = now; speaking = false; phraseEnded = false
        awaitingFinal = false; flushDue = null; armed = true
    }
    fun close() { closed = true; pause() }
    fun poll(now: Long): WatchSilenceAction {
        if (!armed || closed || speaking || now < quietSince || now - quietSince < delayMs) return WatchSilenceAction.NONE
        if (awaitingFinal) {
            val due = flushDue
            if (due == null) {
                flushDue = now + FINAL_FLUSH_MS
                return WatchSilenceAction.STOP_LISTENING
            }
            if (now < due) return WatchSilenceAction.NONE
        }
        closed = true; pause()
        return WatchSilenceAction.FINISH
    }
    companion object {
        const val DEFAULT_DELAY_SECONDS = 10
        const val FINAL_FLUSH_MS = 1500L
        val DELAYS_SECONDS = listOf(5, 10, 15, 30, 60)
        fun normalizeDelay(value: Int) = value.takeIf { it in DELAYS_SECONDS } ?: DEFAULT_DELAY_SECONDS
    }
}
