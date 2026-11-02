package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test

class JVMWatchSpeechAvailabilityCacheTest {
    @Test fun repeatedMinuteAndPhraseStartsReuseOnlyTheShortLivedCapabilityAnswer() {
        val cache = WatchSpeechAvailabilityCache(60_000L)
        var probes = 0
        assertTrue(cache.onDevice(36, 1_000L) { probes++; true })
        assertTrue(cache.onDevice(36, 30_000L) { probes++; false })
        assertTrue(cache.onDevice(36, 60_999L) { probes++; false })
        assertEquals(1, probes)
        assertFalse(cache.onDevice(36, 61_000L) { probes++; false })
        assertEquals(2, probes)
    }

    @Test fun onDeviceSelectionDoesNotProbeOrPopulateTheSystemProvider() {
        val cache = WatchSpeechAvailabilityCache()
        var systemProbes = 0
        assertEquals(WatchSpeechBackend.ON_DEVICE, cache.selectBackend(36, 10L, false,
            { true }, { systemProbes++; true }))
        assertEquals(0, systemProbes)
        assertEquals(WatchSpeechBackend.SYSTEM, cache.selectBackend(36, 20L, true,
            { fail("Explicit fallback probed the on-device provider"); false }, { systemProbes++; true }))
        assertEquals(WatchSpeechBackend.SYSTEM, cache.selectBackend(36, 30L, true,
            { false }, { systemProbes++; false }))
        assertEquals(1, systemProbes)
    }

    @Test fun expiredNegativeAnswersDoNotHideAnInstalledProviderForever() {
        val cache = WatchSpeechAvailabilityCache(5L)
        assertFalse(cache.system(1L) { false })
        assertFalse(cache.system(5L) { true })
        assertTrue(cache.system(6L) { true })
    }

    @Test fun constructionFailureInvalidatesOnlyTheFailedProvider() {
        val cache = WatchSpeechAvailabilityCache()
        assertTrue(cache.onDevice(36, 1L) { true })
        assertTrue(cache.system(1L) { true })
        cache.invalidate(WatchSpeechBackend.ON_DEVICE)
        assertFalse(cache.onDevice(36, 2L) { false })
        assertTrue(cache.system(2L) { false })
        cache.invalidate(WatchSpeechBackend.SYSTEM)
        assertFalse(cache.system(3L) { false })
    }

    @Test fun unavailableResetAndClockRollbackRequireFreshAnswers() {
        val cache = WatchSpeechAvailabilityCache()
        assertTrue(cache.onDevice(36, 100L) { true })
        assertFalse(cache.onDevice(36, 99L) { false })
        assertTrue(cache.system(100L) { true })
        cache.invalidate(WatchSpeechBackend.UNAVAILABLE)
        assertTrue(cache.onDevice(36, 101L) { true })
        assertFalse(cache.system(101L) { false })
    }

    @Test fun olderDevicesNeverInvokeUnsupportedOnDeviceProbe() {
        val cache = WatchSpeechAvailabilityCache()
        assertFalse(cache.onDevice(30, 0L) { fail("Unsupported Android API was probed"); true })
        assertTrue(cache.system(0L) { true })
    }

    @Test fun aFailedProbeIsNotConvertedIntoACachedCapabilityClaim() {
        val cache = WatchSpeechAvailabilityCache()
        try { cache.system(1L) { throw IllegalStateException("Provider changed") }; fail("Expected failed probe") }
        catch (_: IllegalStateException) { }
        assertTrue(cache.system(2L) { true })
    }
}
