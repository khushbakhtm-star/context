package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test

class JVMWatchCustomSilencePolicyTest {
    @Test fun everySupportedCustomSecondSurvivesParsingAndNormalization() {
        assertEquals(1, WatchSilencePolicy.MIN_DELAY_SECONDS)
        assertEquals(300, WatchSilencePolicy.MAX_DELAY_SECONDS)
        for (seconds in 1..300) {
            assertEquals(seconds, WatchSilencePolicy.normalizeDelay(seconds))
            assertEquals(seconds, WatchSilencePolicy.parseDelayInput(seconds.toString()))
        }
    }

    @Test fun presetsRemainAvailableAlongsideCustomValues() {
        assertEquals(listOf(5, 10, 15, 30, 60), WatchSilencePolicy.DELAYS_SECONDS)
        for (preset in WatchSilencePolicy.DELAYS_SECONDS) {
            assertEquals(preset, WatchSilencePolicy.parseDelayInput(preset.toString()))
            assertEquals(preset, WatchSilencePolicy.normalizeDelay(preset))
        }
        for (custom in listOf(1, 9, 11, 17, 61, 137, 299, 300))
            assertEquals(custom, WatchSilencePolicy.normalizeDelay(custom))
    }

    @Test fun corruptStoredValuesFallBackWithoutClampingToAnUnexpectedDelay() {
        for (invalid in listOf(Int.MIN_VALUE, -300, -1, 0, 301, 1_000, Int.MAX_VALUE))
            assertEquals(10, WatchSilencePolicy.normalizeDelay(invalid))
    }

    @Test fun parserAcceptsTrimmedAsciiDigitsAndThreeDigitLeadingZeroes() {
        assertEquals(1, WatchSilencePolicy.parseDelayInput(" \t001\r\n"))
        assertEquals(9, WatchSilencePolicy.parseDelayInput("009"))
        assertEquals(10, WatchSilencePolicy.parseDelayInput("010"))
        assertEquals(99, WatchSilencePolicy.parseDelayInput("099"))
        assertEquals(137, WatchSilencePolicy.parseDelayInput("137"))
        assertEquals(300, WatchSilencePolicy.parseDelayInput(" 300 "))
    }

    @Test fun parserRejectsBlankSignedFractionalScientificAndInternalWhitespaceInput() {
        for (invalid in listOf("", " ", "\t\n", "+10", "-1", "1.0", "1,0", "1e2",
            "1E2", "0x10", "1_0", "1 0", "1\n0", "ten", "10s")) {
            assertNull(invalid, WatchSilencePolicy.parseDelayInput(invalid))
        }
    }

    @Test fun parserRejectsOutOfRangeOversizedAndOverflowingNumbers() {
        for (invalid in listOf("0", "00", "000", "301", "999", "1000", "0001", "0300",
            Int.MAX_VALUE.toString(), Long.MAX_VALUE.toString(), "9".repeat(100))) {
            assertNull(invalid, WatchSilencePolicy.parseDelayInput(invalid))
        }
    }

    @Test fun localizedNumeralsAndInvisibleEmbeddedCharactersCannotChangeTheStoredSetting() {
        for (invalid in listOf("\u0661\u0660", "\uff11\uff10", "1\u200b0", "\u200b10", "1\u00000"))
            assertNull(invalid, WatchSilencePolicy.parseDelayInput(invalid))
    }

    @Test fun everyCustomValueUsesItsExactMonotonicDeadline() {
        val anchor = 47_000L
        for (seconds in 1..300) {
            val policy = WatchSilencePolicy(anchor, seconds)
            val deadline = anchor + seconds * 1000L
            assertEquals("Before ${seconds}s", WatchSilenceAction.NONE, policy.poll(deadline - 1))
            assertEquals("At ${seconds}s", WatchSilenceAction.FINISH, policy.poll(deadline))
            assertEquals(WatchSilenceAction.NONE, policy.poll(deadline + 1))
        }
    }

    @Test fun customDeadlineStillUsesSpeechEndRatherThanFinalResultArrival() {
        for (seconds in listOf(1, 17, 47, 299, 300)) {
            val policy = WatchSilencePolicy(0, seconds)
            policy.providerStarted()
            policy.began(100)
            policy.ended(1_000)
            policy.providerFinished(1_000 + seconds * 500L)
            val deadline = 1_000 + seconds * 1000L
            assertEquals(WatchSilenceAction.NONE, policy.poll(deadline - 1))
            assertEquals(WatchSilenceAction.FINISH, policy.poll(deadline))
        }
    }

    @Test fun oneSecondCaptureRemainsArmedThroughoutItsBoundedFinalFlush() {
        val policy = WatchSilencePolicy(0, 1)
        policy.providerStarted()
        assertEquals(WatchSilenceAction.STOP_LISTENING, policy.poll(1_000))
        assertTrue(policy.isArmed)
        assertTrue(WatchDictationPolicy.keepScreenAwake(true, policy.isArmed))
        assertEquals(WatchSilenceAction.NONE, policy.poll(2_499))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(2_500))
        assertFalse(WatchDictationPolicy.keepScreenAwake(true, policy.isArmed))
    }

    @Test fun minimumCustomDelayCannotTruncateAnActiveUtterance() {
        val policy = WatchSilencePolicy(0, 1)
        policy.providerStarted()
        policy.began(10)
        assertEquals(WatchSilenceAction.NONE, policy.poll(300_000))
        policy.ended(301_000)
        policy.providerFinished(301_050)
        assertEquals(WatchSilenceAction.NONE, policy.poll(301_999))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(302_000))
    }

    @Test fun selectingADifferentCustomDelayStartsANewDeadlineAfterThePause() {
        val policy = WatchSilencePolicy(0, 300)
        policy.pause()
        assertEquals(WatchSilenceAction.NONE, policy.poll(400_000))
        policy.resume(500_000, 17)
        assertEquals(WatchSilenceAction.NONE, policy.poll(516_999))
        assertEquals(WatchSilenceAction.FINISH, policy.poll(517_000))
    }

    @Test fun keepAwakeRequiresBothAVisibleCaptureAndAnArmedTimer() {
        assertTrue(WatchDictationPolicy.keepScreenAwake(true, true))
        assertFalse(WatchDictationPolicy.keepScreenAwake(false, true))
        assertFalse(WatchDictationPolicy.keepScreenAwake(true, false))
        assertFalse(WatchDictationPolicy.keepScreenAwake(false, false))
    }

    @Test fun errorSettingsPauseAndCloseReleaseAwakeUntilExplicitVisibleResume() {
        val policy = WatchSilencePolicy(0, 137)
        assertTrue(WatchDictationPolicy.keepScreenAwake(true, policy.isArmed))
        policy.hardFailure()
        assertFalse(WatchDictationPolicy.keepScreenAwake(true, policy.isArmed))
        policy.resume(200_000, 137)
        assertTrue(WatchDictationPolicy.keepScreenAwake(true, policy.isArmed))
        assertFalse(WatchDictationPolicy.keepScreenAwake(false, policy.isArmed))
        policy.pause()
        assertFalse(WatchDictationPolicy.keepScreenAwake(true, policy.isArmed))
        policy.resume(300_000, 137)
        policy.close()
        policy.resume(400_000, 137)
        assertFalse(WatchDictationPolicy.keepScreenAwake(true, policy.isArmed))
    }
}
