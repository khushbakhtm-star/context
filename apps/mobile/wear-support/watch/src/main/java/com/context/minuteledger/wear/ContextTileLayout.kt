package com.context.minuteledger.wear

import android.graphics.Color
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ColorBuilders.argb
import androidx.wear.protolayout.DimensionBuilders.dp
import androidx.wear.protolayout.DimensionBuilders.expand
import androidx.wear.protolayout.DimensionBuilders.sp
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.TileBuilders
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/** A bounded local minute view. Only the center action means Now at the actual tap. */
internal object ContextTileLayout {
    const val ACTION_EXTRA = "com.context.minuteledger.action"
    const val RECORD_NOW = "com.context.minuteledger.action.RECORD_NOW"
    const val OPEN_MINUTE = "com.context.minuteledger.action.OPEN_MINUTE"
    const val DATE_EXTRA = "com.context.minuteledger.date"
    const val MINUTE_EXTRA = "com.context.minuteledger.minute"
    const val RESOURCES_VERSION = "context-minute-list-2"
    const val TIMELINE_MINUTES = 5
    const val FRESHNESS_MILLIS = 60_000L
    const val ROW_HEIGHT_DP = 28f
    const val ROW_WIDTH_DP = 156f

    fun tile(packageName: String, activityClassName: String, now: ZonedDateTime,
        twelveHourClock: Boolean, note: (String, Int) -> String): TileBuilders.Tile {
        val first = now.withSecond(0).withNano(0)
        val timeline = TimelineBuilders.Timeline.Builder()
        for (offset in 0 until TIMELINE_MINUTES) {
            // Zoned instants keep validity consecutive through midnight and DST changes.
            val center = first.plusMinutes(offset.toLong())
            timeline.addTimelineEntry(TimelineBuilders.TimelineEntry.Builder()
                .setValidity(TimelineBuilders.TimeInterval.Builder()
                    .setStartMillis(center.toInstant().toEpochMilli())
                    .setEndMillis(center.plusMinutes(1).toInstant().toEpochMilli()).build())
                .setLayout(LayoutElementBuilders.Layout.Builder()
                    .setRoot(layout(packageName, activityClassName, center, twelveHourClock, note)).build())
                .build())
        }
        return TileBuilders.Tile.Builder().setResourcesVersion(RESOURCES_VERSION)
            .setFreshnessIntervalMillis(FRESHNESS_MILLIS).setTileTimeline(timeline.build()).build()
    }

    private fun layout(packageName: String, activityClassName: String, center: ZonedDateTime,
        twelveHourClock: Boolean, note: (String, Int) -> String): LayoutElementBuilders.LayoutElement {
        val content = LayoutElementBuilders.Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(text(center.format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault())), 12f, 0xFFBDBDBD.toInt()))
            .addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(4f)).build())
        for (offset in -2..2) {
            val moment = center.plusMinutes(offset.toLong())
            val date = moment.toLocalDate().toString()
            val minute = moment.hour * 60 + moment.minute
            val nowRow = offset == 0
            val time = moment.format(DateTimeFormatter.ofPattern(if (twelveHourClock) "h:mm a" else "HH:mm", Locale.getDefault()))
            val words = shortNote(note(date, minute))
            val activity = ActionBuilders.AndroidActivity.Builder()
                .setPackageName(packageName).setClassName(activityClassName)
                .addKeyToExtraMapping(ACTION_EXTRA, ActionBuilders.AndroidStringExtra.Builder()
                    .setValue(if (nowRow) RECORD_NOW else OPEN_MINUTE).build())
            if (!nowRow) {
                activity.addKeyToExtraMapping(DATE_EXTRA, ActionBuilders.AndroidStringExtra.Builder().setValue(date).build())
                    .addKeyToExtraMapping(MINUTE_EXTRA, ActionBuilders.AndroidIntExtra.Builder().setValue(minute).build())
            }
            val action = ModifiersBuilders.Clickable.Builder().setId("context_minute_$offset")
                .setOnClick(ActionBuilders.LaunchAction.Builder().setAndroidActivity(activity.build()).build()).build()
            val semantics = (if (nowRow) "Current minute. " else "") + "$date. $time. " + words +
                if (nowRow) ". Tap to record now." else ". Tap to edit."
            // The upper/lower rows sit in the narrower chords of a round screen.
            val width = when (kotlin.math.abs(offset)) { 2 -> 128f; 1 -> 148f; else -> ROW_WIDTH_DP }
            val row = LayoutElementBuilders.Row.Builder().setWidth(dp(width)).setHeight(dp(ROW_HEIGHT_DP))
                .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
                .setModifiers(ModifiersBuilders.Modifiers.Builder().setClickable(action)
                    .setPadding(ModifiersBuilders.Padding.Builder().setStart(dp(4f)).setEnd(dp(4f)).build())
                    .setBackground(ModifiersBuilders.Background.Builder().setColor(argb(if (nowRow) 0xFF303030.toInt() else Color.BLACK))
                        .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(5f)).build()).build())
                    .setSemantics(ModifiersBuilders.Semantics.Builder().setContentDescription(semantics).build()).build())
                .addContent(LayoutElementBuilders.Box.Builder().setWidth(dp(if (twelveHourClock) 65f else 43f)).setHeight(expand())
                    .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
                    .addContent(text(time, 12f, if (nowRow) Color.WHITE else 0xFFBDBDBD.toInt())).build())
                .addContent(LayoutElementBuilders.Box.Builder().setWidth(expand()).setHeight(expand())
                    .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
                    .addContent(text(words, 12f, Color.WHITE)).build()).build()
            content.addContent(row)
        }
        return LayoutElementBuilders.Box.Builder().setWidth(expand()).setHeight(expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(ModifiersBuilders.Modifiers.Builder()
                .setBackground(ModifiersBuilders.Background.Builder().setColor(argb(Color.BLACK)).build())
                .setPadding(ModifiersBuilders.Padding.Builder().setAll(dp(8f)).build()).build())
            .addContent(content.build()).build()
    }

    private fun shortNote(value: String): String {
        val plain = value.take(512).replace(Regex("\\s+"), " ").trim()
        val codepoints = plain.codePoints().limit(64).toArray()
        return String(codepoints, 0, codepoints.size)
    }

    private fun text(value: String, size: Float, color: Int) = LayoutElementBuilders.Text.Builder()
        .setText(value).setMaxLines(1).setOverflow(LayoutElementBuilders.TEXT_OVERFLOW_ELLIPSIZE_END)
        .setFontStyle(LayoutElementBuilders.FontStyle.Builder().setSize(sp(size)).setColor(argb(color)).build())
        .build()
}
