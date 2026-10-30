package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test

class JVMLaunchPolicyTest {
    @Test fun idleLauncherAndTileAlwaysRequestAFreshCurrentMinute() {
        val previous = Coordinate("2026-10-26", 650)
        val decision = LaunchPolicy.decide(LaunchTrigger.LAUNCHER_OR_TILE, LaunchState())
        assertTrue(decision.resetToNow); assertFalse(decision.deferredNow)
        assertTrue(decision.startDictation)
        var current = Coordinate("2026-10-26", 1439)
        assertEquals(current, decision.target(previous) { current })
        current = Coordinate("2026-10-27", 0)
        assertEquals(current, decision.target(previous) { current })
    }

    @Test fun idleOnStartReturnsFromBrowsingToNowIncludingAfterMidnight() {
        val selected = Coordinate("2026-10-25", 200)
        val decision = LaunchPolicy.decide(LaunchTrigger.ON_START, LaunchState())
        assertEquals(Coordinate("2026-10-27", 5), decision.target(selected) { Coordinate("2026-10-27", 5) })
        assertFalse(decision.deferredNow)
        assertFalse(decision.startDictation)
    }

    @Test fun speechImePickerAndPendingRestoreNeverAcquireANewMinuteOnStart() {
        val selected = Coordinate("2026-10-26", 1439)
        for (state in listOf(LaunchState(editorOpen = true), LaunchState(restoringEditor = true),
            LaunchState(speechInFlight = true), LaunchState(pickerOpen = true))) {
            val decision = LaunchPolicy.decide(LaunchTrigger.ON_START, state)
            assertFalse(decision.resetToNow); assertFalse(decision.deferredNow)
            assertFalse(decision.startDictation)
            assertEquals(selected, decision.target(selected) { error("A protected resume must not sample Now") })
        }
    }

    @Test fun explicitReentryDefersUntilTheEditorActuallyCloses() {
        val request = LaunchPolicy.decide(LaunchTrigger.LAUNCHER_OR_TILE, LaunchState(editorOpen = true))
        assertFalse(request.resetToNow); assertTrue(request.deferredNow)
        assertFalse(request.startDictation)
        val resume = LaunchPolicy.decide(LaunchTrigger.ON_START, LaunchState(editorOpen = true,
            speechInFlight = true, deferredNow = request.deferredNow))
        assertFalse(resume.resetToNow); assertTrue(resume.deferredNow)
        val closed = LaunchPolicy.decide(LaunchTrigger.EDITOR_CLOSED, LaunchState(deferredNow = resume.deferredNow))
        assertTrue(closed.resetToNow); assertFalse(closed.deferredNow)
        assertFalse(closed.startDictation)
        assertEquals(Coordinate("2026-10-27", 1), closed.target(Coordinate("2026-10-26", 1439)) { Coordinate("2026-10-27", 1) })
    }

    @Test fun ordinarySaveOrCancelDoesNotInventAnotherEntryRequest() {
        val closed = LaunchPolicy.decide(LaunchTrigger.EDITOR_CLOSED, LaunchState())
        assertFalse(closed.resetToNow); assertFalse(closed.deferredNow)
        assertFalse(closed.startDictation)
    }

    @Test fun remainingPickerOrSpeechKeepsAnExplicitDeferredRequestProtected() {
        for (state in listOf(LaunchState(pickerOpen = true, deferredNow = true),
            LaunchState(speechInFlight = true, deferredNow = true), LaunchState(restoringEditor = true, deferredNow = true))) {
            val decision = LaunchPolicy.decide(LaunchTrigger.EDITOR_CLOSED, state)
            assertFalse(decision.resetToNow); assertTrue(decision.deferredNow)
        }
    }

    @Test fun configurationRestorationPreservesTheSavedSessionAndDeferredRequest() {
        val state = LaunchState(restoringEditor = true, deferredNow = true)
        val decision = LaunchPolicy.decide(LaunchTrigger.RESTORE, state)
        assertFalse(decision.resetToNow); assertTrue(decision.deferredNow)
        assertFalse(decision.startDictation)
        val selected = Coordinate("2026-10-26", 1438)
        assertEquals(selected, decision.target(selected) { error("Restoration is not a new launch") })
    }

    @Test fun onlyAPristineAutomaticEditorCanBeReplacedOnWarmReentry() {
        for (open in listOf(false, true)) assertTrue(LaunchPolicy.mayReplacePristineAutoEditor(
            true, "Original cached text", "Original cached text", false, LaunchState(editorOpen = open)))
        assertTrue(LaunchPolicy.mayReplacePristineAutoEditor(true, "", "", false, LaunchState(deferredNow = true)))
    }

    @Test fun manualDirtyColoredAndUnavailableEditorsAreNeverPristineReplacementTargets() {
        assertFalse(LaunchPolicy.mayReplacePristineAutoEditor(false, "", "", false, LaunchState()))
        assertFalse(LaunchPolicy.mayReplacePristineAutoEditor(true, "Changed", "Original", false, LaunchState()))
        assertFalse(LaunchPolicy.mayReplacePristineAutoEditor(true, " ", "", false, LaunchState()))
        assertFalse(LaunchPolicy.mayReplacePristineAutoEditor(true, null, "", false, LaunchState()))
        assertFalse(LaunchPolicy.mayReplacePristineAutoEditor(true, "Original", "Original", true, LaunchState()))
    }

    @Test fun speechRestoreAndPickerProtectionPreventsEvenAPristineAutomaticReplacement() {
        for (state in listOf(LaunchState(speechInFlight = true), LaunchState(restoringEditor = true),
            LaunchState(pickerOpen = true), LaunchState(editorOpen = true, speechInFlight = true, deferredNow = true))) {
            assertFalse(LaunchPolicy.mayReplacePristineAutoEditor(true, "Original", "Original", false, state))
        }
    }

    @Test fun restoredEditorRetainsItsOriginalVersionCoordinateColorAndPendingIdentity() {
        val original = EditorSession(Coordinate("2026-10-26", 1439), true,
            "[\"original-minute-revision\",\"original-format-revision\"]", "prayer", "pending-original")
        val restored = original.copy()
        val newerPhoneVersion = "[\"new-phone-minute\",\"new-phone-format\"]"
        assertEquals(original, restored); assertNotEquals(newerPhoneVersion, restored.expectedVersion)
        val recolored = restored.copy(chosenCategory = "family")
        assertEquals(original.coordinate, recolored.coordinate); assertEquals(original.baseKnown, recolored.baseKnown)
        assertEquals(original.expectedVersion, recolored.expectedVersion); assertEquals(original.pendingOperationId, recolored.pendingOperationId)
        assertEquals("prayer", original.chosenCategory)
        val unknown = EditorSession(Coordinate("2026-10-27", 0), false, null)
        assertEquals(unknown, unknown.copy()); assertNull(unknown.expectedVersion)
    }
    @Test fun onlyAFreshLauncherOrTileIntentMayArmAnAutomaticCapture() {
        assertTrue(LaunchPolicy.freshEntry(false, true))
        assertFalse(LaunchPolicy.freshEntry(true, true))
        assertFalse(LaunchPolicy.freshEntry(false, false))
        assertFalse(LaunchPolicy.freshEntry(true, false))
        // Returning from settings, permissions, an IME or an auto-saved note is ON_START,
        // and a deferred old launch can move the view without starting another microphone.
        for (trigger in listOf(LaunchTrigger.ON_START, LaunchTrigger.RESTORE, LaunchTrigger.EDITOR_CLOSED)) {
            assertFalse(LaunchPolicy.decide(trigger, LaunchState(deferredNow = true)).startDictation)
        }
    }
    @Test fun aPermissionGrantMayResumeOnlyItsExactVisibleEditorOnceItIsResumed() {
        val original = EditorSession(Coordinate("2026-10-30", 1439), true, "original-version")
        assertTrue(LaunchPolicy.mayResumeMicrophone(original, original.copy(), true, true, true, false))
        assertFalse(LaunchPolicy.mayResumeMicrophone(null, original, true, true, true, false))
        assertFalse(LaunchPolicy.mayResumeMicrophone(original, null, true, true, true, false))
        assertFalse(LaunchPolicy.mayResumeMicrophone(original, original.copy(sessionId = "another-editor"), true, true, true, false))
        assertFalse(LaunchPolicy.mayResumeMicrophone(original,
            original.copy(coordinate = Coordinate("2026-10-31", 0)), true, true, true, false))
        assertFalse(LaunchPolicy.mayResumeMicrophone(original, original, false, true, true, false))
        assertFalse(LaunchPolicy.mayResumeMicrophone(original, original, true, false, true, false))
        assertFalse(LaunchPolicy.mayResumeMicrophone(original, original, true, true, false, false))
        assertFalse(LaunchPolicy.mayResumeMicrophone(original, original, true, true, true, true))
        assertEquals("original-version", original.expectedVersion)
    }
    @Test fun aLateOrReplayedPermissionCallbackCannotConsumeAnotherEditorRequest() {
        val original = EditorSession(Coordinate("2026-10-30", 1400), true, "old-baseline")
        assertTrue(LaunchPolicy.acceptsMicrophoneGrant(101, 101, original, original.copy()))
        assertFalse(LaunchPolicy.acceptsMicrophoneGrant(100, 101, original, original))
        assertFalse(LaunchPolicy.acceptsMicrophoneGrant(101, null, original, original))
        assertFalse(LaunchPolicy.acceptsMicrophoneGrant(101, 101, null, original))
        assertFalse(LaunchPolicy.acceptsMicrophoneGrant(101, 101, original, original.copy(sessionId = "new-editor")))
        assertFalse(LaunchPolicy.acceptsMicrophoneGrant(101, 101, original,
            original.copy(coordinate = Coordinate("2026-10-31", 0))))
    }
}
