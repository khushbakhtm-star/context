package com.context.minuteledger.wear

/** A confirmed recognizer result always retains its original editor baseline.
 * The journal must atomically deduplicate operationId, including after an ACK. */
data class DictationSavePlan(
    val speech: SpeechSession,
    val editor: EditorSession,
    val text: String,
    val writeRequired: Boolean,
) {
    val operationId: String get() = speech.operationId

    /** Call only after the local journal has durably accepted the operation.
     * An unchanged pending note keeps its original operation identity. */
    fun acknowledgedSession(): EditorSession = editor.copy(
        pendingOperationId = if (writeRequired) operationId else editor.pendingOperationId,
        pendingText = text,
        pendingCategory = editor.chosenCategory,
    )
}

object DictationSavePolicy {
    const val MAX_TEXT_LENGTH = 50_000

    /** A successful automatic save closes entry without creating another one.
     * A separate launcher/Tile request deferred during dictation still runs. */
    fun resumeTrigger(confirmedSavedReturn: Boolean, deferredNow: Boolean): LaunchTrigger? = when {
        !confirmedSavedReturn -> LaunchTrigger.ON_START
        deferredNow -> LaunchTrigger.EDITOR_CLOSED
        else -> null
    }

    /** Cancel, unavailable/blank results and stale callbacks leave the draft alone.
     * No current clock, refreshed phone snapshot or mutable selected row is read. */
    fun prepare(pending: SpeechSession?, requestCode: Int, editor: EditorSession?,
        successful: Boolean, rawText: String?): DictationSavePlan? {
        val session = editor ?: return null
        if (!successful || !SpeechSessionGuard.accepts(pending, requestCode, session) ||
            rawText == null || rawText.length > MAX_TEXT_LENGTH) return null
        val text = rawText.trim()
        if (text.isEmpty()) return null
        return DictationSavePlan(requireNotNull(pending), session, text, session.needsSave(text))
    }
}
