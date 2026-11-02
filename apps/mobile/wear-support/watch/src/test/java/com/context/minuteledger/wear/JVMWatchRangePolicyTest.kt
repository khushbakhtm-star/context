package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test

class JVMWatchRangePolicyTest {
    private fun cell(minute: Int = 20, cached: String? = "cached-v1", pending: String = "pending-v1",
        known: Boolean = true, version: String? = "[old,format]", category: String? = null,
        occupied: Boolean = false) = WatchRangeCellBaseline(Coordinate("2026-11-02", minute), cached,
        pending, known, version, category, occupied)
    private fun rejected(action: () -> Unit) {
        try { action(); fail("Expected the guarded range operation to be rejected") }
        catch (_: IllegalArgumentException) { }
    }

    @Test fun singleMinuteIncludesItsEntireSelectedMinute() {
        val minute = Coordinate("2026-11-02", 24)
        assertEquals(listOf(minute), WatchRangePolicy.coordinates(minute, minute))
    }
    @Test fun parserAcceptsExplicit24HourCoordinatesAndTrimsTheirOuterWhitespace() {
        assertEquals(Coordinate("2026-11-02", 1439), WatchRangePolicy.coordinate(" 2026-11-02 ", " 23:59 "))
        assertEquals(Coordinate("2026-11-02", 0), WatchRangePolicy.coordinate("2026-11-02", "00:00"))
    }
    @Test fun parserRejectsAmbiguousTimesAndOutOfRangeHoursOrMinutes() {
        for (time in listOf("7:24", "12:04 PM", "24:00", "23:60", "-1:00", "7.24", "07:240", ""))
            assertNull(time, WatchRangePolicy.coordinate("2026-11-02", time))
    }
    @Test fun parserRejectsImpossibleDatesAndHandlesLeapYears() {
        assertEquals(Coordinate("2028-02-29", 60), WatchRangePolicy.coordinate("2028-02-29", "01:00"))
        for (date in listOf("2026-02-29", "2026-11-31", "2026-13-01", "2026-11-2", "11/02/2026", ""))
            assertNull(date, WatchRangePolicy.coordinate(date, "01:00"))
    }
    @Test fun ordinarySpanIncludesBothEnds() {
        assertEquals((24..27).map { Coordinate("2026-11-02", it) },
            WatchRangePolicy.coordinates(Coordinate("2026-11-02", 24), Coordinate("2026-11-02", 27)))
    }
    @Test fun consecutiveOvernightSpanCrossesItsActualDate() {
        assertEquals(listOf(Coordinate("2026-11-01", 1438), Coordinate("2026-11-01", 1439),
            Coordinate("2026-11-02", 0), Coordinate("2026-11-02", 1)),
            WatchRangePolicy.coordinates(Coordinate("2026-11-01", 1438), Coordinate("2026-11-02", 1)))
    }
    @Test fun fullCivilDayHas1440DistinctMinutes() {
        val result = WatchRangePolicy.coordinates(Coordinate("2026-11-02", 0), Coordinate("2026-11-02", 1439))
        assertEquals(1440, result.size); assertEquals(1440, result.toSet().size)
    }
    @Test fun overnight1440MinuteLimitIsAlsoInclusive() {
        val result = WatchRangePolicy.coordinates(Coordinate("2026-11-01", 720), Coordinate("2026-11-02", 719))
        assertEquals(1440, result.size)
        rejected { WatchRangePolicy.coordinates(Coordinate("2026-11-01", 720), Coordinate("2026-11-02", 720)) }
    }
    @Test fun reverseTimesNeverSilentlyFillTomorrow() {
        rejected { WatchRangePolicy.coordinates(Coordinate("2026-11-02", 60), Coordinate("2026-11-02", 59)) }
        rejected { WatchRangePolicy.coordinates(Coordinate("2026-11-02", 60), Coordinate("2026-11-01", 61)) }
    }
    @Test fun farApartDatesAreRejectedBeforeAnArrayAllocation() {
        rejected { WatchRangePolicy.coordinates(Coordinate("0001-01-01", 0), Coordinate("9999-12-31", 1439)) }
    }
    @Test fun rangeTextMustContainWordsAndStayWithinExistingMinuteLimit() {
        rejected { WatchRangePolicy.validateText("") }; rejected { WatchRangePolicy.validateText(" \n\t") }
        WatchRangePolicy.validateText("Sleep")
        WatchRangePolicy.validateText("x".repeat(50_000))
        rejected { WatchRangePolicy.validateText("x".repeat(50_001)) }
    }
    @Test fun payloadLimitIncludesJsonArrayBytesAtItsExactBoundary() {
        WatchRangePolicy.validatePayload(listOf(262_144, 262_144, 262_144, 262_139))
        rejected { WatchRangePolicy.validatePayload(listOf(262_144, 262_144, 262_144, 262_140)) }
    }
    @Test fun anIndividualOperationCannotExceedTheExistingTransportLimit() {
        WatchRangePolicy.validatePayload(listOf(262_144))
        rejected { WatchRangePolicy.validatePayload(listOf(262_145)) }
        rejected { WatchRangePolicy.validatePayload(listOf(0)) }
        rejected { WatchRangePolicy.validatePayload(listOf(-1)) }
    }
    @Test fun unchangedRangeCanContain1440OperationsOrNoOpWrites() {
        WatchRangePolicy.validatePayload(List(1440) { 200 })
        WatchRangePolicy.validatePayload(emptyList())
        rejected { WatchRangePolicy.validatePayload(List(1441) { 200 }) }
    }
    @Test fun everySelectedBaselineMustBePresentAndInTheSameOrder() {
        val observed = listOf(cell(20), cell(21))
        WatchRangePolicy.requireUnchanged(observed, observed.toList())
        rejected { WatchRangePolicy.requireUnchanged(observed, observed.take(1)) }
        rejected { WatchRangePolicy.requireUnchanged(observed, observed.reversed()) }
        rejected { WatchRangePolicy.requireUnchanged(emptyList(), emptyList()) }
    }
    @Test fun aPhoneEditInTheLastMinuteRejectsTheWholeRange() {
        val observed = listOf(cell(20), cell(21), cell(22))
        var commitReached = false
        rejected {
            WatchRangePolicy.requireUnchanged(observed, observed.dropLast(1) + cell(22, cached = "changed"))
            commitReached = true
        }
        assertFalse(commitReached)
    }
    @Test fun pendingAckRemovalCannotRefreshAnOldConfirmationBaseline() {
        rejected { WatchRangePolicy.requireUnchanged(listOf(cell()), listOf(cell(pending = "no-pending"))) }
    }
    @Test fun pendingPayloadIdentityOrStatusChangeRejectsEvenIfWordsMatch() {
        rejected { WatchRangePolicy.requireUnchanged(listOf(cell()), listOf(cell(pending = "same-words-new-id"))) }
        rejected { WatchRangePolicy.requireUnchanged(listOf(cell()), listOf(cell(pending = "same-id-conflict"))) }
    }
    @Test fun aBlankPartialDayBecomingKnownNeedsFreshReview() {
        rejected { WatchRangePolicy.requireUnchanged(listOf(cell(cached = null, known = false, version = null)),
            listOf(cell(cached = null, known = true, version = "[null,null]"))) }
    }
    @Test fun originalVersionAndPendingCategoryRemainPartOfTheFrozenPlan() {
        rejected { WatchRangePolicy.requireUnchanged(listOf(cell()), listOf(cell(version = "new-version"))) }
        rejected { WatchRangePolicy.requireUnchanged(listOf(cell()), listOf(cell(category = "different-color"))) }
    }
    @Test fun planOwnsFrozenListsAndRetainsItsOriginalTextAndCoordinates() {
        val cells = mutableListOf(cell(20), cell(21, occupied = true))
        val operations = mutableListOf("first", "second")
        val plan = WatchRangePlan(cells.first().coordinate, cells.last().coordinate, "Sleep", cells, operations)
        cells.clear(); operations.clear()
        assertEquals(2, plan.count); assertEquals(2, plan.writeCount); assertTrue(plan.hasOccupied)
        assertEquals("Sleep", plan.text); assertEquals(Coordinate("2026-11-02", 20), plan.start)
        assertEquals(Coordinate("2026-11-02", 21), plan.end)
        try { (plan.payloads() as MutableList<String>).add("changed"); fail("Frozen plan list must not be writable") }
        catch (_: UnsupportedOperationException) { }
    }
}
