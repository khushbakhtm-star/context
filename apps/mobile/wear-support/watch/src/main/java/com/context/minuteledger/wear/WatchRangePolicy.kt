package com.context.minuteledger.wear

import java.time.LocalDate
import java.util.Collections

/** Frozen local observations, never a freshly sampled replacement baseline. */
internal data class WatchRangeCellBaseline(
    val coordinate: Coordinate,
    val cachedDigest: String?,
    val pendingDigest: String,
    val baseKnown: Boolean,
    val expectedVersion: String?,
    val pendingCategory: String?,
    val differentOccupiedText: Boolean,
)

/** One bounded, immutable same-text fill. Only WatchStore can create its operations. */
class WatchRangePlan internal constructor(
    val start: Coordinate,
    val end: Coordinate,
    val text: String,
    cells: List<WatchRangeCellBaseline>,
    operations: List<String>,
) {
    private val frozenCells = Collections.unmodifiableList(ArrayList(cells))
    private val frozenOperations = Collections.unmodifiableList(ArrayList(operations))
    val count: Int get() = frozenCells.size
    val writeCount: Int get() = frozenOperations.size
    val hasOccupied: Boolean get() = frozenCells.any { it.differentOccupiedText }
    internal fun baselines(): List<WatchRangeCellBaseline> = frozenCells
    internal fun payloads(): List<String> = frozenOperations
}

/** Pure civil-minute geometry and all-or-nothing range validation. */
object WatchRangePolicy {
    const val MAX_MINUTES = 1440
    const val MAX_TEXT_LENGTH = 50_000
    const val MAX_OPERATION_BYTES = 256 * 1024
    const val MAX_PAYLOAD_BYTES = 1024 * 1024

    fun coordinate(date: String, time: String): Coordinate? {
        val cleanDate = date.trim(); val cleanTime = time.trim()
        if (!Regex("\\d{4}-\\d{2}-\\d{2}").matches(cleanDate) ||
            !Regex("(?:[01]\\d|2[0-3]):[0-5]\\d").matches(cleanTime)) return null
        return runCatching { Coordinate(cleanDate, cleanTime.substring(0, 2).toInt() * 60 + cleanTime.substring(3, 5).toInt()) }.getOrNull()
    }

    fun coordinates(start: Coordinate, end: Coordinate): List<Coordinate> {
        val days = LocalDate.parse(end.dateKey).toEpochDay() - LocalDate.parse(start.dateKey).toEpochDay()
        val distance = days * 1440L + end.minuteIndex - start.minuteIndex
        require(distance in 0 until MAX_MINUTES.toLong()) { "Choose 1–1440 consecutive minutes, with the end after the start." }
        return List(distance.toInt() + 1) { start.move(it) }
    }

    fun validateText(text: String) {
        require(text.isNotBlank() && text.length <= MAX_TEXT_LENGTH) { "Enter text of at most 50,000 characters." }
    }

    /** Counts the serialized JSON-array delimiters as well as every operation. */
    fun validatePayload(operationBytes: List<Int>) {
        require(operationBytes.size <= MAX_MINUTES) { "Too many watch edits." }
        require(operationBytes.all { it in 1..MAX_OPERATION_BYTES }) { "A watch edit is too large." }
        val total = 2L + operationBytes.sumOf { it.toLong() } + maxOf(0, operationBytes.size - 1)
        require(total <= MAX_PAYLOAD_BYTES) { "This range is too large. Choose fewer minutes or shorter text." }
    }

    internal fun requireUnchanged(expected: List<WatchRangeCellBaseline>, actual: List<WatchRangeCellBaseline>) {
        require(expected.isNotEmpty() && expected.size <= MAX_MINUTES && expected == actual) {
            "These minutes changed. Reopen the range and review it before saving."
        }
    }
}
