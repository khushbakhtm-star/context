package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test

class JVMWatchSilencePolicyTest {
    @Test fun unsupportedTimeoutsUseTheTenSecondDefault() {
        assertEquals(10, WatchSilencePolicy.DEFAULT_DELAY_SECONDS)
        assertEquals(listOf(5, 10, 15, 30, 60), WatchSilencePolicy.DELAYS_SECONDS)
        for (seconds in WatchSilencePolicy.DELAYS_SECONDS) {
            assertEquals(seconds, WatchSilencePolicy.normalizeDelay(seconds))
            val policy = WatchSilencePolicy(100, seconds)
            assertEquals(WatchSilenceAction.NONE, policy.poll(100 + seconds * 1000L - 1))
            assertEquals(WatchSilenceAction.FINISH, policy.poll(100 + seconds * 1000L))
        }
        for (invalid in listOf(-1, 0, 1, 9, 11, 61, Int.MAX_VALUE))
            assertEquals(10, WatchSilencePolicy.normalizeDelay(invalid))
    }

    @Test fun initialBlankSilenceFinishesOnceWithoutInventingSpeech() {
        val policy = WatchSilencePolicy(500)
        assertEquals(WatchSilenceAction.NONE, policy.poll(10_499))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(10_500))
        assertEquals(WatchSilenceAction.NONE, policy.poll(90_000))
        assertFalse(policy.canListen)
        assertFalse(policy.isArmed)
    }

    @Test fun outstandingRecognizerGetsOneBoundedFinalResultFlush() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        assertEquals(WatchSilenceAction.STOP_LISTENING, policy.poll(10_000))
        assertFalse(policy.canListen)
        assertEquals(WatchSilenceAction.NONE, policy.poll(10_001))
        assertEquals(WatchSilenceAction.NONE, policy.poll(11_499))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(11_500))
        assertEquals(WatchSilenceAction.NONE, policy.poll(11_501))
    }

    @Test fun activeUtteranceCanExceedTheSilenceTimeout() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        policy.began(100)
        assertEquals(WatchSilenceAction.NONE, policy.poll(50_000))
        policy.ended(50_100)
        policy.providerFinished(50_300)
        assertEquals(WatchSilenceAction.NONE, policy.poll(60_099))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(60_100))
    }

    @Test fun finalResultLatencyDoesNotExtendSilenceAfterSpeechEnded() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        policy.began(100)
        policy.ended(1_000)
        policy.providerFinished(8_000)
        assertEquals(WatchSilenceAction.NONE, policy.poll(10_999))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(11_000))
    }

    @Test fun lateRevisedPartialAfterSpeechEndedDoesNotInventNewSpeech() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        policy.began(100)
        policy.ended(1_000)
        policy.changedPartial(7_000)
        policy.providerFinished(8_000)
        assertEquals(WatchSilenceAction.FINISH, policy.poll(11_000))
    }

    @Test fun duplicateEndSignalsDoNotMoveTheOriginalDeadline() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        policy.began(100)
        policy.ended(1_000)
        policy.ended(7_000)
        policy.providerFinished(8_000)
        assertEquals(WatchSilenceAction.FINISH, policy.poll(11_000))
    }

    @Test fun providerCompletionIsTheSafeEndWhenSpeechEndCallbackIsMissing() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        policy.began(100)
        policy.providerFinished(20_000)
        assertEquals(WatchSilenceAction.NONE, policy.poll(29_999))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(30_000))
    }

    @Test fun changedPartialProtectsAnUtteranceWhenBeginningCallbackIsMissing() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        policy.changedPartial(2_000)
        assertEquals(WatchSilenceAction.NONE, policy.poll(20_000))
        policy.ended(21_000)
        policy.providerFinished(22_000)
        assertEquals(WatchSilenceAction.FINISH, policy.poll(31_000))
    }

    @Test fun blankProviderCyclesDoNotRestartTheInitialSilenceClock() {
        val policy = WatchSilencePolicy(0)
        for (completion in listOf(2_000L, 5_000L, 9_000L)) {
            policy.providerStarted()
            policy.providerFinished(completion)
        }
        assertEquals(WatchSilenceAction.FINISH, policy.poll(10_000))
    }

    @Test fun genuineNextUtteranceCreatesANewSilenceDeadline() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        policy.began(100)
        policy.ended(1_000)
        policy.providerFinished(2_000)
        policy.providerStarted()
        policy.began(10_000)
        assertEquals(WatchSilenceAction.NONE, policy.poll(20_000))
        policy.ended(21_000)
        policy.providerFinished(22_000)
        assertEquals(WatchSilenceAction.NONE, policy.poll(30_999))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(31_000))
    }

    @Test fun hardFailureNeverAutomaticallyConfirmsAPartialDraft() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        policy.began(100)
        policy.changedPartial(1_000)
        policy.hardFailure()
        policy.ended(2_000)
        policy.providerFinished(3_000)
        policy.providerStarted()
        assertEquals(WatchSilenceAction.NONE, policy.poll(90_000))
        assertFalse(policy.isArmed)
        assertFalse(policy.canListen)
    }

    @Test fun settingsPauseResumesOnlyWithAFreshConfiguredDeadline() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        policy.pause()
        assertEquals(WatchSilenceAction.NONE, policy.poll(20_000))
        policy.resume(25_000, 5)
        assertTrue(policy.isArmed)
        assertTrue(policy.canListen)
        assertEquals(WatchSilenceAction.NONE, policy.poll(29_999))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(30_000))
    }

    @Test fun explicitContinueCanRecoverAfterFailureWithoutUsingTheOldDeadline() {
        val policy = WatchSilencePolicy(0)
        policy.hardFailure()
        policy.resume(50_000)
        assertEquals(WatchSilenceAction.NONE, policy.poll(59_999))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(60_000))
    }

    @Test fun latePartialDuringFinalFlushDoesNotCancelOrExtendTheFlush() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        policy.began(100)
        policy.ended(1_000)
        assertEquals(WatchSilenceAction.STOP_LISTENING, policy.poll(11_000))
        policy.changedPartial(11_400)
        assertFalse(policy.canListen)
        assertEquals(WatchSilenceAction.NONE, policy.poll(12_499))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(12_500))
    }

    @Test fun finalResultDuringFlushFinishesWithoutASecondFullSilenceWait() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        assertEquals(WatchSilenceAction.STOP_LISTENING, policy.poll(10_000))
        policy.providerFinished(10_500)
        assertEquals(WatchSilenceAction.FINISH, policy.poll(10_500))
        assertEquals(WatchSilenceAction.NONE, policy.poll(11_500))
    }

    @Test fun doneCancelOrBackgroundCloseIsTerminalDespiteLateCallbacksAndResume() {
        val policy = WatchSilencePolicy(0)
        policy.providerStarted()
        assertEquals(WatchSilenceAction.STOP_LISTENING, policy.poll(10_000))
        policy.close()
        policy.providerFinished(10_100)
        policy.began(10_200)
        policy.changedPartial(10_300)
        policy.ended(10_400)
        policy.resume(11_000, 5)
        policy.providerStarted()
        assertEquals(WatchSilenceAction.NONE, policy.poll(90_000))
        assertFalse(policy.isArmed)
        assertFalse(policy.canListen)
    }

    @Test fun aClockValueBeforeTheQuietAnchorCannotTriggerAnEarlySave() {
        val policy = WatchSilencePolicy(50_000)
        assertEquals(WatchSilenceAction.NONE, policy.poll(49_999))
        assertEquals(WatchSilenceAction.NONE, policy.poll(59_999))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(60_000))
    }
}
