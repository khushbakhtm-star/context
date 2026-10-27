package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test

class JVMSpeechSessionGuardTest {
    private fun editor(minute: Int = 1439) = EditorSession(Coordinate("2026-10-26", minute), true,
        "[\"original-minute\",\"original-format\"]")

    @Test fun acceptsOnlyTheExactRequestAndImmutableEditorCoordinate() {
        val editor = editor(); val speech = SpeechSession(101, editor.sessionId, editor.coordinate)
        assertTrue(SpeechSessionGuard.accepts(speech, 101, editor))
        assertFalse(SpeechSessionGuard.accepts(speech, 100, editor))
        assertFalse(SpeechSessionGuard.accepts(speech, 101, editor.copy(coordinate = Coordinate("2026-10-27", 0))))
    }

    @Test fun aNewInvocationRejectsTheOlderResultEvenWithinTheSameEditor() {
        val editor = editor(); val current = SpeechSession(102, editor.sessionId, editor.coordinate)
        assertFalse(SpeechSessionGuard.accepts(current, 101, editor))
        assertTrue(SpeechSessionGuard.accepts(current, 102, editor))
    }

    @Test fun cancelAndNewEditorAtTheSameMinuteCannotAcceptAnOldResult() {
        val oldEditor = editor(); val oldSpeech = SpeechSession(103, oldEditor.sessionId, oldEditor.coordinate)
        assertFalse(SpeechSessionGuard.accepts(null, 103, oldEditor))
        val newEditor = editor(); assertNotEquals(oldEditor.sessionId, newEditor.sessionId)
        assertFalse(SpeechSessionGuard.accepts(oldSpeech, 103, newEditor))
        assertFalse(SpeechSessionGuard.accepts(oldSpeech, 103, null))
    }

    @Test fun restorationRetainsSpeechAndEditorIdentityWithoutReadingAFresherPhoneVersion() {
        val editor = editor(); val speech = SpeechSession(104, editor.sessionId, editor.coordinate)
        val restoredEditor = editor.copy(chosenCategory = "family")
        val restoredSpeech = speech.copy()
        assertEquals(editor.sessionId, restoredEditor.sessionId)
        assertEquals(editor.expectedVersion, restoredEditor.expectedVersion)
        assertTrue(SpeechSessionGuard.accepts(restoredSpeech, 104, restoredEditor))
        val resume = LaunchPolicy.decide(LaunchTrigger.ON_START, LaunchState(restoringEditor = true, speechInFlight = true))
        assertFalse(resume.resetToNow)
        assertEquals(editor.coordinate, resume.target(editor.coordinate) { error("Dictation must retain yesterday's selected minute") })
    }

    @Test fun invalidRequestCodesAndEmptyEditorIdentityAreRejectedAtConstruction() {
        val coordinate = Coordinate("2026-10-27", 0)
        for (code in listOf(-1, 65536)) {
            try { SpeechSession(code, "session", coordinate); fail("Invalid request code accepted") }
            catch (_: IllegalArgumentException) { }
        }
        try { SpeechSession(105, " ", coordinate); fail("Blank editor identity accepted") }
        catch (_: IllegalArgumentException) { }
    }

    @Test fun anAcknowledgedPendingNoteDoesNotCreateAnUnchangedDuplicateSave() {
        val session = editor().copy(pendingOperationId = "pending-1", pendingText = "Make coffee",
            pendingCategory = "family", chosenCategory = "family")
        // No live pending receipt is consulted: a phone ACK cannot change this result.
        assertFalse(session.needsSave("Make coffee"))
        assertFalse(session.copy().needsSave("Make coffee"))
        assertTrue(session.needsSave("Make tea"))
        assertTrue(session.copy(chosenCategory = "study").needsSave("Make coffee"))
        assertEquals(editor().expectedVersion, session.expectedVersion)
    }

    @Test fun aNewEditorOrMissingLegacySnapshotStillSavesItsPayload() {
        assertTrue(editor().needsSave(""))
        assertTrue(editor().copy(pendingOperationId = "legacy").needsSave("Make coffee"))
        val empty = editor().copy(pendingOperationId = "pending-2", pendingText = "")
        assertFalse(empty.needsSave(""))
    }
}
