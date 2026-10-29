package com.context.minuteledger.wear

import java.time.LocalDateTime
import org.junit.Assert.*
import org.junit.Test

class JVMWatchDictationPolicyTest {
    private val point = Coordinate("2026-10-28", 12 * 60 + 59)
    private fun editor() = EditorSession(point, true, "known-version", sessionId = "editor-current")
    private fun speech(editor: EditorSession = editor()) = SpeechSession(107, editor.sessionId, editor.coordinate, "speech-current")

    @Test fun dictatePrefersOnDeviceRecognitionButStartsSystemSpeechWithoutAnotherChoice() {
        assertEquals(WatchSpeechBackend.ON_DEVICE, WatchDictationPolicy.backend(31, true, true))
        assertEquals(WatchSpeechBackend.ON_DEVICE, WatchDictationPolicy.backend(36, true, false))
        assertEquals(WatchSpeechBackend.SYSTEM, WatchDictationPolicy.backend(30, true, true))
        assertEquals(WatchSpeechBackend.SYSTEM, WatchDictationPolicy.backend(36, false, true))
        assertEquals(WatchSpeechBackend.SYSTEM, WatchDictationPolicy.backend(36, false, true, true))
        assertEquals(WatchSpeechBackend.SYSTEM, WatchDictationPolicy.backend(30, false, true, true))
        assertEquals(WatchSpeechBackend.UNAVAILABLE, WatchDictationPolicy.backend(36, true, false, true))
    }
    @Test fun noAvailableProviderFailsWithoutPretendingAnOfflineModelExists() {
        for (api in listOf(30, 31, 36)) {
            assertEquals(WatchSpeechBackend.UNAVAILABLE, WatchDictationPolicy.backend(api, false, false))
            assertEquals(WatchSpeechBackend.UNAVAILABLE, WatchDictationPolicy.backend(api, false, false, true))
        }
        assertEquals(WatchSpeechBackend.UNAVAILABLE, WatchDictationPolicy.backend(30, true, false))
    }
    @Test fun unavailableOnDeviceConstructionOrLanguageFallsBackToSystemOnlyOnce() {
        for (failure in listOf(WatchSpeechFailure.UNAVAILABLE, WatchSpeechFailure.MODEL)) {
            assertTrue(WatchDictationPolicy.retryWithSystem(WatchSpeechBackend.ON_DEVICE, failure, true, false))
            assertFalse(WatchDictationPolicy.retryWithSystem(WatchSpeechBackend.ON_DEVICE, failure, false, false))
            assertFalse(WatchDictationPolicy.retryWithSystem(WatchSpeechBackend.ON_DEVICE, failure, true, true))
            assertEquals(WatchSpeechBackend.SYSTEM, WatchDictationPolicy.backend(36, true, true, true))
        }
    }
    @Test fun microphonePauseBusyAndSystemFailuresNeverCreateAnAutomaticRetryLoop() {
        for (failure in WatchSpeechFailure.values()) {
            assertFalse(WatchDictationPolicy.retryWithSystem(WatchSpeechBackend.SYSTEM, failure, true, false))
            assertFalse(WatchDictationPolicy.retryWithSystem(WatchSpeechBackend.UNAVAILABLE, failure, true, false))
        }
        for (failure in listOf(WatchSpeechFailure.MICROPHONE, WatchSpeechFailure.EMPTY,
            WatchSpeechFailure.BUSY, WatchSpeechFailure.NETWORK)) {
            assertFalse(WatchDictationPolicy.retryWithSystem(WatchSpeechBackend.ON_DEVICE, failure, true, false))
        }
        // A normal phrase restart retains the selected system provider, even if on-device
        // recognition still advertises itself after failing to initialize.
        assertEquals(WatchSpeechBackend.SYSTEM, WatchDictationPolicy.backend(36, true, true, true))
    }
    @Test fun liveClockShowsSecondsAndMinuteRolloverWithoutRetargetingTheNote() {
        val before = LocalDateTime.parse("2026-10-28T12:59:59")
        assertEquals("12:59:59", WatchDictationPolicy.clock(before))
        assertEquals("13:00:00", WatchDictationPolicy.clock(before.plusSeconds(1)))
        assertEquals("12:59:59 PM", WatchDictationPolicy.clock(before, true))
        assertEquals("1:00:00 PM", WatchDictationPolicy.clock(before.plusSeconds(1), true))
        assertEquals("12:00:00 AM", WatchDictationPolicy.clock(LocalDateTime.parse("2026-10-28T00:00:00"), true))
        assertEquals("Note 2026-10-28 12:59", WatchDictationPolicy.minuteLabel(point))
        assertEquals("Note 2026-10-28 12:59 PM", WatchDictationPolicy.minuteLabel(point, true))
        assertEquals(Coordinate("2026-10-28", 779), point)
    }
    @Test fun midnightAndYearRolloverKeepTheOriginalSelectedDayAndFinalSaveCoordinate() {
        val selected = Coordinate("2026-12-31", 1439)
        val session = editor().copy(coordinate = selected)
        val pending = speech(session)
        val after = LocalDateTime.parse("2027-01-01T00:00:00")
        assertEquals("00:00:00", WatchDictationPolicy.clock(after))
        assertEquals("Note 2026-12-31 23:59", WatchDictationPolicy.minuteLabel(selected))
        val plan = DictationSavePolicy.prepare(pending, pending.requestCode, session, true, "Confirmed words")!!
        assertEquals(selected, plan.editor.coordinate)
        assertEquals(pending.operationId, plan.operationId)
    }
    @Test fun retriedOrCancelledRecognizerCallbacksCannotDeliverToTheCurrentRun() {
        val guard = WatchDictationRunGuard()
        val old = guard.begin(); assertTrue(guard.accepts(old))
        guard.invalidate(); assertFalse(guard.accepts(old))
        val current = guard.begin(); assertFalse(guard.accepts(old)); assertTrue(guard.accepts(current))
        guard.close(); assertFalse(guard.accepts(current))
        try { guard.begin(); fail("A closed microphone run was restarted") } catch (_: IllegalStateException) { }
    }
    @Test fun explicitTypeOrLifecycleCanRetainPartialWordsAsOnlyAnEditableDraft() {
        val session = editor(); val pending = speech(session)
        assertEquals("Partial words", WatchDictationPolicy.preservedDraft(pending, 107, session,
            "Original draft", "Original draft", "  Partial words  "))
        assertEquals("known-version", session.expectedVersion)
        assertNull(session.pendingOperationId)
        assertNull(DictationSavePolicy.prepare(pending, 107, session, false, "Partial words"))
    }
    @Test fun staleOrNewerEditorTextIsNeverOverwrittenByAnUnconfirmedPartial() {
        val session = editor(); val pending = speech(session)
        assertNull(WatchDictationPolicy.preservedDraft(pending, 107, session, "Original", "Newer typed edit", "Old partial"))
        assertNull(WatchDictationPolicy.preservedDraft(pending, 106, session, "Original", "Original", "Old partial"))
        assertNull(WatchDictationPolicy.preservedDraft(pending, 107, session.copy(sessionId = "new-editor"), "Original", "Original", "Old partial"))
        assertNull(WatchDictationPolicy.preservedDraft(null, 107, session, "Original", "Original", "Old partial"))
        assertNull(WatchDictationPolicy.preservedDraft(pending, 107, session, "Original", "Original", " "))
        assertNull(WatchDictationPolicy.preservedDraft(pending, 107, session, "Original", "Original", "x".repeat(50_001)))
    }
    @Test fun restoredDraftDoesNotReopenACancelledMicrophoneOrAcceptItsLateFinalResult() {
        val oldRun = WatchDictationRunGuard(); val token = oldRun.begin(); oldRun.close()
        val restoredEditor = editor(); val fresh = WatchDictationRunGuard(); val newToken = fresh.begin()
        assertFalse(oldRun.accepts(token)); assertTrue(fresh.accepts(newToken))
        assertNull(DictationSavePolicy.prepare(null, 107, restoredEditor, true, "Late final result"))
        assertEquals("Note 2026-10-28 12:59", WatchDictationPolicy.minuteLabel(restoredEditor.coordinate))
    }
    @Test fun unavailabilityMessagesDoNotPromiseAnOfflineModelOrACloudUpload() {
        assertTrue(WatchDictationPolicy.failure(WatchSpeechFailure.MODEL, true).contains("Offline speech is unavailable"))
        assertTrue(WatchDictationPolicy.failure(WatchSpeechFailure.MODEL, false).contains("selected language"))
        assertTrue(WatchDictationPolicy.failure(WatchSpeechFailure.NETWORK, false).contains("may need internet"))
        assertFalse(WatchDictationPolicy.failure(WatchSpeechFailure.NETWORK, true).contains("will work"))
    }
    @Test fun breathsSeparatePhrasesWithoutDiscardingEarlierWords() {
        val note = WatchDictationNote()
        note.beginPhrase(); assertTrue(note.preview("Mum said"))
        assertTrue(note.acceptPhrase("Mum said"))
        // A provider's final result keeps the draft; it has no save callback.
        note.beginPhrase(); assertEquals("Mum said", note.text)
        assertTrue(note.preview("make an appointment"))
        assertTrue(note.acceptPhrase("make an appointment"))
        note.beginPhrase(); assertTrue(note.acceptPhrase("for next Tuesday"))
        assertEquals("Mum said make an appointment for next Tuesday", note.text)
        assertEquals(note.text, note.confirmDisplayed())
    }
    @Test fun partialHypothesesReplaceOnlyTheirOwnPhraseAndDoneConfirmsTheDisplayedWords() {
        val note = WatchDictationNote()
        assertNull(note.confirmDisplayed())
        note.beginPhrase(); assertTrue(note.acceptPhrase("First thought.")); note.beginPhrase()
        assertTrue(note.preview("Second")); assertTrue(note.preview("Second thought"))
        assertEquals("First thought. Second thought", note.text)
        assertTrue(note.acceptPhrase("Second thought."))
        assertEquals("First thought. Second thought.", note.text)
        note.beginPhrase(); assertTrue(note.preview("Third thought"))
        assertEquals("First thought. Second thought. Third thought", note.confirmDisplayed())
    }
    @Test fun retryRetainsTheWordsSeenBeforeAnInterruptionWithoutDuplicatingTheNextPartial() {
        val note = WatchDictationNote()
        assertTrue(note.acceptPhrase("Earlier words")); note.beginPhrase()
        assertTrue(note.preview("before a network interruption")); note.beginPhrase()
        assertEquals("Earlier words before a network interruption", note.text)
        assertTrue(note.preview("continuing")); assertTrue(note.preview("continuing now"))
        assertEquals("Earlier words before a network interruption continuing now", note.text)
        assertTrue(note.acceptPhrase("continuing now"))
        assertEquals("Earlier words before a network interruption continuing now", note.confirmDisplayed())
    }
    @Test fun emptyOrOversizedProviderResultsCannotEraseAnExistingNoteDraft() {
        val note = WatchDictationNote()
        assertTrue(note.acceptPhrase("Keep me")); note.beginPhrase()
        assertFalse(note.acceptPhrase("  ")); assertFalse(note.preview("x".repeat(50_001)))
        assertFalse(note.acceptPhrase("x".repeat(50_001)))
        assertEquals("Keep me", note.text)
        assertTrue(note.preview("still here"))
        assertFalse(note.acceptPhrase("x".repeat(50_001)))
        assertEquals("Keep me still here", note.confirmDisplayed())
    }
}
