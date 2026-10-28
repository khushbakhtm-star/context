package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test
import java.util.ArrayDeque

class JVMCoalescedPendingWorkTest {
    @Test fun burstSchedulesOnePendingSender() {
        val queue = ArrayDeque<() -> Unit>()
        var calls = 0
        val sender = CoalescedPendingWork({ queue.add(it) }) { calls++ }
        repeat(100) { sender.request() }
        assertEquals(1, queue.size); queue.removeFirst()()
        assertEquals(1, calls); assertTrue(queue.isEmpty())
    }

    @Test fun editsArrivingDuringSendGetOneFollowUp() {
        val queue = ArrayDeque<() -> Unit>()
        var calls = 0
        lateinit var sender: CoalescedPendingWork
        sender = CoalescedPendingWork({ queue.add(it) }) {
            calls++; if (calls == 1) repeat(100) { sender.request() }
        }
        sender.request(); queue.removeFirst()()
        assertEquals(2, calls); assertTrue(queue.isEmpty())
    }

    @Test fun sustainedRequestsYieldAfterTwoSendsInsteadOfHoldingTheExecutor() {
        val queue = ArrayDeque<() -> Unit>()
        var calls = 0
        lateinit var sender: CoalescedPendingWork
        sender = CoalescedPendingWork({ queue.add(it) }) { calls++; if (calls <= 2) sender.request() }
        sender.request(); queue.removeFirst()()
        assertEquals(2, calls); assertEquals(1, queue.size)
        queue.removeFirst()(); assertEquals(3, calls); assertTrue(queue.isEmpty())
    }

    @Test fun aFailedSendCanBeRetriedWithoutDroppingTheDurableJournal() {
        val queue = ArrayDeque<() -> Unit>()
        val journal = mutableListOf("exact immutable operation")
        var failed = true
        val sender = CoalescedPendingWork({ queue.add(it) }) { if (failed) error("offline") else assertEquals(1, journal.size) }
        sender.request(); assertThrows(IllegalStateException::class.java) { queue.removeFirst()() }
        assertEquals(listOf("exact immutable operation"), journal)
        failed = false; sender.request(); queue.removeFirst()(); assertTrue(queue.isEmpty())
    }
}
