package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test

class LedgerRulesTest {
    @Test fun minuteRollingCrossesCivilDates() {
        assertEquals(Coordinate("2026-11-01", 0), Coordinate("2026-10-31", 1439).move(1))
        assertEquals(Coordinate("2026-10-31", 1439), Coordinate("2026-11-01", 0).move(-1))
        assertEquals(Coordinate("2028-02-29", 12), Coordinate("2028-03-01", 12).move(-1440))
    }
    @Test fun staleAcknowledgmentCannotReplaceNewerPendingText() {
        assertFalse(LedgerRules.mayApplyAckToCache("older", "newer"))
        assertTrue(LedgerRules.mayApplyAckToCache("same", "same"))
    }
    @Test fun olderHistoryCannotReplaceNewerHistory() {
        assertFalse(LedgerRules.newerSnapshot(99, 100))
        assertTrue(LedgerRules.newerSnapshot(100, 99))
    }
    @Test fun snapshotsPreserveBothMinuteAndFormatRevisions() {
        assertTrue(LedgerRules.olderCell("0002", "0001", "0002", "0003"))
        assertTrue(LedgerRules.olderCell("0001", "0004", "0002", "0003"))
        assertFalse(LedgerRules.olderCell("0003", "0004", "0002", "0003"))
    }
}
