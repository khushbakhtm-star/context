package com.context.minuteledger.wear

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import org.junit.Assert.*
import org.junit.Test
import java.time.ZonedDateTime

class ContextTileLayoutTest {
    private fun tile(now: String = "2026-10-30T12:34:48Z", twelveHour: Boolean = false,
        note: (String, Int) -> String = { _, _ -> "" }) = ContextTileLayout.tile("com.context.minuteledger",
        "com.context.minuteledger.wear.MinuteActivity", ZonedDateTime.parse(now), twelveHour, note)

    private fun rows(tile: androidx.wear.tiles.TileBuilders.Tile, index: Int = 0): List<LayoutElementBuilders.Row> {
        val root = tile.tileTimeline!!.timelineEntries[index].layout!!.root as LayoutElementBuilders.Box
        val column = root.contents.single() as LayoutElementBuilders.Column
        return column.contents.filterIsInstance<LayoutElementBuilders.Row>()
    }
    private fun activity(row: LayoutElementBuilders.Row) =
        (row.modifiers!!.clickable!!.onClick as ActionBuilders.LaunchAction).androidActivity!!
    private fun words(row: LayoutElementBuilders.Row, column: Int): LayoutElementBuilders.Text =
        (row.contents[column] as LayoutElementBuilders.Box).contents.single() as LayoutElementBuilders.Text

    @Test fun currentRowLaunchesFreshNowWithoutAStaleCoordinate() {
        val middle = activity(rows(tile())[2])
        assertEquals("com.context.minuteledger", middle.packageName)
        assertEquals("com.context.minuteledger.wear.MinuteActivity", middle.className)
        assertEquals(setOf(ContextTileLayout.ACTION_EXTRA), middle.keyToExtraMapping.keys)
        assertEquals(ContextTileLayout.RECORD_NOW,
            (middle.keyToExtraMapping[ContextTileLayout.ACTION_EXTRA] as ActionBuilders.AndroidStringExtra).value)
    }

    @Test fun surroundingRowsCarryExactDatesAndIntegerMinutes() {
        val rows = rows(tile())
        assertEquals(5, rows.size)
        for (index in listOf(0, 1, 3, 4)) {
            val target = activity(rows[index]).keyToExtraMapping
            assertEquals(setOf(ContextTileLayout.ACTION_EXTRA, ContextTileLayout.DATE_EXTRA, ContextTileLayout.MINUTE_EXTRA), target.keys)
            assertEquals(ContextTileLayout.OPEN_MINUTE, (target[ContextTileLayout.ACTION_EXTRA] as ActionBuilders.AndroidStringExtra).value)
            assertEquals("2026-10-30", (target[ContextTileLayout.DATE_EXTRA] as ActionBuilders.AndroidStringExtra).value)
            assertEquals(12 * 60 + 34 + index - 2, (target[ContextTileLayout.MINUTE_EXTRA] as ActionBuilders.AndroidIntExtra).value)
        }
    }

    @Test fun timelineIsFiveBoundedConsecutiveMinutesWithMinuteFreshness() {
        val snapshot = tile()
        assertEquals(ContextTileLayout.RESOURCES_VERSION, snapshot.resourcesVersion)
        assertEquals(60_000L, snapshot.freshnessIntervalMillis)
        val entries = snapshot.tileTimeline!!.timelineEntries
        assertEquals(5, entries.size)
        val start = ZonedDateTime.parse("2026-10-30T12:34:00Z").toInstant().toEpochMilli()
        for ((index, entry) in entries.withIndex()) {
            assertEquals(start + index * 60_000L, entry.validity!!.startMillis)
            assertEquals(start + (index + 1) * 60_000L, entry.validity!!.endMillis)
        }
    }

    @Test fun midnightRowsRetainPreviousAndNextDayInsteadOfClamping() {
        val before = rows(tile("2026-10-30T00:00:12Z"))
        val previous = activity(before[1]).keyToExtraMapping
        assertEquals("2026-10-29", (previous[ContextTileLayout.DATE_EXTRA] as ActionBuilders.AndroidStringExtra).value)
        assertEquals(1439, (previous[ContextTileLayout.MINUTE_EXTRA] as ActionBuilders.AndroidIntExtra).value)
        val after = rows(tile("2026-10-30T23:59:12Z"))
        val next = activity(after[3]).keyToExtraMapping
        assertEquals("2026-10-31", (next[ContextTileLayout.DATE_EXTRA] as ActionBuilders.AndroidStringExtra).value)
        assertEquals(0, (next[ContextTileLayout.MINUTE_EXTRA] as ActionBuilders.AndroidIntExtra).value)
    }

    @Test fun springClockChangeSkipsTheMissingHourWithoutBreakingTimelineValidity() {
        val snapshot = tile("2026-03-08T01:59:30-05:00[America/New_York]")
        assertEquals("03:00", words(rows(snapshot)[3], 0).text!!.value)
        val entries = snapshot.tileTimeline!!.timelineEntries
        assertEquals(entries[0].validity!!.endMillis, entries[1].validity!!.startMillis)
        assertEquals(60_000L, entries[1].validity!!.endMillis - entries[1].validity!!.startMillis)
    }

    @Test fun autumnClockChangeKeepsExactCivilNeighborAndConsecutiveInstants() {
        val snapshot = tile("2026-11-01T01:59:30-04:00[America/New_York]")
        val after = activity(rows(snapshot)[3]).keyToExtraMapping
        assertEquals(60, (after[ContextTileLayout.MINUTE_EXTRA] as ActionBuilders.AndroidIntExtra).value)
        val entries = snapshot.tileTimeline!!.timelineEntries
        assertEquals(entries[0].validity!!.endMillis, entries[1].validity!!.startMillis)
        assertEquals(60_000L, entries[1].validity!!.endMillis - entries[1].validity!!.startMillis)
    }

    @Test fun notesAreSingleLineBoundedAndIncludedInAccessibleRows() {
        val rows = rows(tile(note = { _, _ -> "  dentist\n  appointment " + "☕".repeat(200) }))
        for (row in rows) {
            val note = words(row, 1)
            assertEquals(1, note.maxLines!!.value)
            assertTrue(note.text!!.value.startsWith("dentist appointment "))
            assertTrue(note.text!!.value.codePointCount(0, note.text!!.value.length) <= 64)
            val description = row.modifiers!!.semantics!!.contentDescription!!.value
            assertTrue(description.contains("2026-10-30"))
            assertTrue(description.contains(note.text!!.value))
        }
    }

    @Test fun compactRowsStayInsideRoundScreenBudgetAndOnlyNowHasHighlight() {
        val snapshot = tile(); val list = rows(snapshot)
        assertTrue(5 * ContextTileLayout.ROW_HEIGHT_DP + 36f <= 198f)
        assertTrue(ContextTileLayout.ROW_WIDTH_DP <= 156f)
        for ((index, row) in list.withIndex()) {
            assertEquals(ContextTileLayout.ROW_HEIGHT_DP, (row.height as DimensionBuilders.DpProp).value)
            assertEquals(if (index == 2) 0xFF303030.toInt() else 0xFF000000.toInt(), row.modifiers!!.background!!.color!!.argb)
        }
    }

    @Test fun taperedRowsKeepTheirTextInsideSmallRoundScreenChords() {
        val list = rows(tile())
        for (diameter in listOf(192f, 198f, 220f)) {
            val radius = diameter / 2f
            // Date label14dp, gap4dp, then five28dp rows. Text is at most14dp high.
            val start = (diameter - (18f + 5f * 28f)) / 2f + 18f
            for ((index, row) in list.withIndex()) {
                val centerY = start + index * 28f + 14f
                val furthestTextY = maxOf(kotlin.math.abs(centerY - radius - 7f), kotlin.math.abs(centerY - radius + 7f))
                val safeChord = 2f * kotlin.math.sqrt(radius * radius - furthestTextY * furthestTextY)
                val textWidth = (row.width as DimensionBuilders.DpProp).value - 8f
                assertTrue("Row$index text exceeds ${diameter}dp circle", textWidth <= safeChord)
            }
        }
    }

    @Test fun twelveHourPreferenceChangesLabelsWithoutChangingCoordinates() {
        val before = rows(tile(twelveHour = false)); val after = rows(tile(twelveHour = true))
        assertEquals("12:34", words(before[2], 0).text!!.value)
        assertTrue(words(after[2], 0).text!!.value.startsWith("12:34"))
        for (index in before.indices) assertEquals(activity(before[index]).keyToExtraMapping.keys, activity(after[index]).keyToExtraMapping.keys)
    }
}
