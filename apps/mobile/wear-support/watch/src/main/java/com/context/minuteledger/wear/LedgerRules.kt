package com.context.minuteledger.wear

import java.time.LocalDate

data class Coordinate(val dateKey: String, val minuteIndex: Int) {
    init { require(minuteIndex in 0..1439); require(Regex("\\d{4}-\\d{2}-\\d{2}").matches(dateKey)); LocalDate.parse(dateKey) }
    fun move(minutes: Int): Coordinate {
        val total = minuteIndex.toLong() + minutes
        return Coordinate(LocalDate.parse(dateKey).plusDays(Math.floorDiv(total, 1440L)).toString(),
            Math.floorMod(total, 1440L).toInt())
    }
}

/** A response may acknowledge one operation, but must never erase another draft. */
object LedgerRules {
    fun mayApplyAckToCache(operationId: String, latestPendingId: String?): Boolean =
        latestPendingId == null || latestPendingId == operationId

    fun newerSnapshot(incoming: Long, existing: Long): Boolean = incoming >= existing
    fun olderCell(minute: String, format: String, cachedMinute: String, cachedFormat: String): Boolean =
        minute < cachedMinute || format < cachedFormat
}
