package com.context.minuteledger.wear

/**
 * Capability checks may cross into Android's package/service manager. Reuse their
 * answers for one short foreground-use window instead of repeating them for every
 * minute or phrase. This stores booleans only, never an Activity, microphone grant,
 * recognizer, text or audio. Recognition still starts only in the visible session.
 */
class WatchSpeechAvailabilityCache(private val lifetimeMillis: Long = 60_000L) {
    private data class Entry(val checkedAt: Long, val available: Boolean)
    private var onDevice: Entry? = null
    private var system: Entry? = null

    init { require(lifetimeMillis > 0L) }

    @Synchronized
    fun onDevice(api: Int, elapsedMillis: Long, probe: () -> Boolean): Boolean {
        if (api < 31) return false
        return resolve(onDevice, elapsedMillis, probe).also { onDevice = it }.available
    }

    @Synchronized
    fun system(elapsedMillis: Long, probe: () -> Boolean): Boolean =
        resolve(system, elapsedMillis, probe).also { system = it }.available

    /** Resolve only the provider needed for the caller's current explicit capture. */
    fun selectBackend(api: Int, elapsedMillis: Long, preferSystem: Boolean,
        onDeviceProbe: () -> Boolean, systemProbe: () -> Boolean): WatchSpeechBackend {
        val useOnDevice = !preferSystem && onDevice(api, elapsedMillis, onDeviceProbe)
        return WatchDictationPolicy.backend(api, useOnDevice,
            if (useOnDevice) false else system(elapsedMillis, systemProbe), preferSystem)
    }

    /** A provider that disappears or rejects construction is checked again next time. */
    @Synchronized
    fun invalidate(backend: WatchSpeechBackend) {
        when (backend) {
            WatchSpeechBackend.ON_DEVICE -> onDevice = null
            WatchSpeechBackend.SYSTEM -> system = null
            WatchSpeechBackend.UNAVAILABLE -> { onDevice = null; system = null }
        }
    }

    private fun resolve(entry: Entry?, elapsedMillis: Long, probe: () -> Boolean): Entry {
        require(elapsedMillis >= 0L)
        // A monotonic-clock rollback never extends the lifetime of an old answer.
        if (entry != null && elapsedMillis >= entry.checkedAt &&
            elapsedMillis - entry.checkedAt < lifetimeMillis) return entry
        return Entry(elapsedMillis, probe())
    }
}
