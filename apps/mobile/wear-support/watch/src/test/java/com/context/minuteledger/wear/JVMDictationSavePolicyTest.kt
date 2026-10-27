package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test

class JVMDictationSavePolicyTest {
    private fun editor() = EditorSession(Coordinate("2026-10-26", 1439), true,
        "[\"original-minute\",\"original-format\"]", "prayer", sessionId = "historical-editor")
    private fun speech(editor: EditorSession = editor()) = SpeechSession(107, editor.sessionId,
        editor.coordinate, "speech-operation")

    @Test fun ordinaryOrCanceledSpeechReturnRetainsTheNormalProtectedResumePolicy() {
        for (deferred in listOf(false, true)) {
            assertEquals(LaunchTrigger.ON_START, DictationSavePolicy.resumeTrigger(false, deferred))
            val decision = LaunchPolicy.decide(requireNotNull(DictationSavePolicy.resumeTrigger(false, deferred)),
                LaunchState(editorOpen = true, deferredNow = deferred))
            assertFalse(decision.resetToNow)
            assertEquals(deferred, decision.deferredNow)
        }
    }

    @Test fun successfulSpeechSaveDoesNotOpenAFreshNowEditorOnResume() {
        assertNull(DictationSavePolicy.resumeTrigger(true, false))
        // The one-shot success flag is consumed by Activity; a later ordinary
        // foreground entry must still retain the normal Now-launch behavior.
        val later = requireNotNull(DictationSavePolicy.resumeTrigger(false, false))
        assertTrue(LaunchPolicy.decide(later, LaunchState()).resetToNow)
    }

    @Test fun explicitDeferredNowRequestRunsAfterSuccessfulSpeechSave() {
        val trigger = requireNotNull(DictationSavePolicy.resumeTrigger(true, true))
        assertEquals(LaunchTrigger.EDITOR_CLOSED, trigger)
        val decision = LaunchPolicy.decide(trigger, LaunchState(deferredNow = true))
        assertTrue(decision.resetToNow)
        assertFalse(decision.deferredNow)
        assertEquals(Coordinate("2026-10-27", 0), decision.target(editor().coordinate) { Coordinate("2026-10-27", 0) })
    }

    @Test fun confirmationRetainsTheHistoricalMinuteAndOriginalConcurrencyBaseline() {
        val editor = editor(); val speech = speech(editor)
        val plan = requireNotNull(DictationSavePolicy.prepare(speech, 107, editor, true, "  Make coffee ☕\nTalk to mum  "))
        assertEquals("Make coffee ☕\nTalk to mum", plan.text)
        assertEquals(Coordinate("2026-10-26", 1439), plan.editor.coordinate)
        assertEquals(editor, plan.editor)
        assertTrue(plan.editor.baseKnown)
        assertEquals(editor.expectedVersion, plan.editor.expectedVersion)
        assertEquals("prayer", plan.editor.chosenCategory)
        assertEquals("speech-operation", plan.operationId)
        assertTrue(plan.writeRequired)
    }

    @Test fun cancellationFailureBlankAndMissingRecognitionNeverCreateAnAutomaticSave() {
        val editor = editor(); val speech = speech(editor)
        for (value in listOf(null, "", " \n\t\r ")) {
            assertNull(DictationSavePolicy.prepare(speech, 107, editor, true, value))
        }
        assertNull(DictationSavePolicy.prepare(speech, 107, editor, false, "new text"))
        assertEquals("prayer", editor.chosenCategory)
        assertNull(editor.pendingOperationId)
    }

    @Test fun onlyTheExactPendingSpeechAndEditorCanProduceASavePlan() {
        val editor = editor(); val speech = speech(editor)
        assertNull(DictationSavePolicy.prepare(null, 107, editor, true, "text"))
        assertNull(DictationSavePolicy.prepare(speech, 106, editor, true, "text"))
        assertNull(DictationSavePolicy.prepare(speech, 107, null, true, "text"))
        assertNull(DictationSavePolicy.prepare(speech, 107, editor.copy(sessionId = "new-editor"), true, "text"))
        assertNull(DictationSavePolicy.prepare(speech, 107,
            editor.copy(coordinate = Coordinate("2026-10-27", 0)), true, "text"))
    }

    @Test fun recreationAndRetryRetainOneOperationIdentityAndPayload() {
        val editor = editor(); val speech = speech(editor)
        val first = requireNotNull(DictationSavePolicy.prepare(speech, 107, editor, true, "Confirmed"))
        val restored = requireNotNull(DictationSavePolicy.prepare(speech.copy(), 107, editor.copy(), true, "Confirmed"))
        assertEquals(first, restored)
        assertEquals(first.operationId, restored.operationId)
        // The same id is presented to the atomic journal after a failed write or
        // recreation; an ACK disappearing must not manufacture a fresh UUID.
        assertEquals("speech-operation", restored.operationId)
        val acknowledged = restored.acknowledgedSession()
        assertFalse(acknowledged.needsSave("Confirmed"))
        assertEquals(editor.expectedVersion, acknowledged.expectedVersion)
        assertEquals(editor.coordinate, acknowledged.coordinate)
    }

    @Test fun unchangedAlreadyPendingNoteIsSentWithoutEnqueuingADuplicate() {
        val editor = editor().copy(pendingOperationId = "existing-operation", pendingText = "Confirmed",
            pendingCategory = "prayer")
        val plan = requireNotNull(DictationSavePolicy.prepare(speech(editor), 107, editor, true, "Confirmed"))
        assertFalse(plan.writeRequired)
        assertEquals("existing-operation", plan.acknowledgedSession().pendingOperationId)
        assertFalse(plan.acknowledgedSession().needsSave("Confirmed"))
    }

    @Test fun changedCategoryOrNoteRequiresANewImmutableSpeechOperation() {
        val previous = editor().copy(pendingOperationId = "previous", pendingText = "Confirmed", pendingCategory = "prayer")
        val changedColor = previous.copy(chosenCategory = "family")
        val plan = requireNotNull(DictationSavePolicy.prepare(speech(changedColor), 107, changedColor, true, "Confirmed"))
        assertTrue(plan.writeRequired)
        assertEquals("family", plan.acknowledgedSession().pendingCategory)
        assertEquals("speech-operation", plan.acknowledgedSession().pendingOperationId)
        assertTrue(requireNotNull(DictationSavePolicy.prepare(speech(previous), 107, previous, true, "Changed")).writeRequired)
        assertEquals("previous", previous.pendingOperationId)
    }

    @Test fun recognizerTextMustFitTheExistingEditorLimitWithoutSilentTruncation() {
        val editor = editor(); val speech = speech(editor)
        val maximum = "x".repeat(DictationSavePolicy.MAX_TEXT_LENGTH)
        assertEquals(maximum, requireNotNull(DictationSavePolicy.prepare(speech, 107, editor, true, maximum)).text)
        assertNull(DictationSavePolicy.prepare(speech, 107, editor, true, maximum + "x"))
    }

    @Test fun newInvocationsHaveDistinctStableIdsEvenWhenRequestCodesWrap() {
        val editor = editor()
        val first = SpeechSession(107, editor.sessionId, editor.coordinate)
        val second = SpeechSession(107, editor.sessionId, editor.coordinate)
        assertNotEquals(first.operationId, second.operationId)
        assertEquals(first.operationId, first.copy().operationId)
        try {
            SpeechSession(107, editor.sessionId, editor.coordinate, " ")
            fail("Blank operation id accepted")
        } catch (_: IllegalArgumentException) { }
    }
}
