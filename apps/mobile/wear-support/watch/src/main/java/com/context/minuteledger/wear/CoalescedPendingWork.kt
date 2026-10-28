package com.context.minuteledger.wear

/** A burst queues one sender and at most one follow-up per executor turn. */
class CoalescedPendingWork(private val execute: (() -> Unit) -> Unit, private val send: () -> Unit) {
    private var scheduled = false
    private var requested = false

    @Synchronized fun request() {
        requested = true
        if (scheduled) return
        scheduled = true
        execute { run() }
    }

    private fun run() {
        try {
            repeat(2) {
                val needed = synchronized(this) { val value = requested; requested = false; value }
                if (!needed) return
                send()
            }
        } finally {
            synchronized(this) {
                scheduled = false
                if (requested) request()
            }
        }
    }
}
