package com.context.minuteledger.wear

import java.util.UUID

enum class LaunchTrigger { LAUNCHER_OR_TILE, ON_START, RESTORE, EDITOR_CLOSED }

data class LaunchState(
    val editorOpen: Boolean = false,
    val restoringEditor: Boolean = false,
    val speechInFlight: Boolean = false,
    val pickerOpen: Boolean = false,
    val deferredNow: Boolean = false,
) {
    val protectsEditing: Boolean
        get() = editorOpen || restoringEditor || speechInFlight || pickerOpen
}

data class LaunchDecision(val resetToNow: Boolean, val deferredNow: Boolean) {
    /** Evaluate the clock when applying a fresh launch, never when restoring a draft. */
    fun target(selected: Coordinate, now: () -> Coordinate): Coordinate = if (resetToNow) now() else selected
}

/** Lifecycle callbacks must not rebind a note to another minute. A genuine new
 * entry request may wait for Save/Cancel; speech/IME resumes do not create one. */
object LaunchPolicy {
    /** An untouched automatic entry may follow a later launch; explicit historical
     * editors and in-progress external input retain their original coordinate. */
    fun mayReplacePristineAutoEditor(autoNow: Boolean, rawText: String?, initialText: String,
        categoryChosen: Boolean, state: LaunchState): Boolean = autoNow && rawText != null &&
        rawText == initialText && !categoryChosen && !state.restoringEditor &&
        !state.speechInFlight && !state.pickerOpen

    fun decide(trigger: LaunchTrigger, state: LaunchState): LaunchDecision = when (trigger) {
        LaunchTrigger.RESTORE -> LaunchDecision(false, state.deferredNow)
        LaunchTrigger.LAUNCHER_OR_TILE -> if (state.protectsEditing) LaunchDecision(false, true)
            else LaunchDecision(true, false)
        LaunchTrigger.ON_START -> if (state.protectsEditing) LaunchDecision(false, state.deferredNow)
            else LaunchDecision(true, false)
        LaunchTrigger.EDITOR_CLOSED -> if (state.protectsEditing) LaunchDecision(false, state.deferredNow)
            else LaunchDecision(state.deferredNow, false)
    }
}

/** Keep the original concurrency baseline when UI/speech is restored. A newer
 * phone snapshot must never silently become the expected version of old text. */
data class EditorSession(
    val coordinate: Coordinate,
    val baseKnown: Boolean,
    val expectedVersion: String?,
    val chosenCategory: String? = null,
    val pendingOperationId: String? = null,
    val sessionId: String = UUID.randomUUID().toString(),
    val pendingText: String? = null,
    val pendingCategory: String? = null,
) {
    /** The receipt may disappear after phone acknowledgement while this editor
     * stays open. Compare the original immutable payload, not a live inbox. */
    fun needsSave(text: String): Boolean = pendingOperationId == null || pendingText == null ||
        text != pendingText || chosenCategory != pendingCategory
}
