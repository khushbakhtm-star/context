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

/** No ledger inputs: this public surface contains only a static shortcut. */
internal object ContextTileLayout {
    const val ACTION_EXTRA = "com.context.minuteledger.action"
    const val RECORD_NOW = "com.context.minuteledger.action.RECORD_NOW"
    const val RESOURCES_VERSION = "context-record-now-1"

    fun tile(packageName: String, activityClassName: String, label: String, recordLabel: String, description: String): TileBuilders.Tile =
        TileBuilders.Tile.Builder().setResourcesVersion(RESOURCES_VERSION)
            .setTileTimeline(TimelineBuilders.Timeline.Builder()
                .addTimelineEntry(TimelineBuilders.TimelineEntry.Builder()
                    .setLayout(LayoutElementBuilders.Layout.Builder()
                        .setRoot(layout(packageName, activityClassName, label, recordLabel, description)).build())
                    .build()).build())
            .build()

    private fun layout(packageName: String, activityClassName: String, label: String, recordLabel: String, description: String): LayoutElementBuilders.LayoutElement {
        // Schema 1.0 LaunchAction accepts an exact Activity and extras, not arbitrary Intent flags.
        // The Activity resolves Now at the tap. No rendered timestamp can become a stale destination.
        val launch = ActionBuilders.LaunchAction.Builder()
            .setAndroidActivity(ActionBuilders.AndroidActivity.Builder()
                .setPackageName(packageName).setClassName(activityClassName)
                .addKeyToExtraMapping(ACTION_EXTRA, ActionBuilders.AndroidStringExtra.Builder().setValue(RECORD_NOW).build())
                .build()).build()
        val action = ModifiersBuilders.Clickable.Builder().setId("context_record_now").setOnClick(launch).build()
        val record = LayoutElementBuilders.Box.Builder().setWidth(dp(136f)).setHeight(dp(56f))
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(ModifiersBuilders.Modifiers.Builder()
                .setBackground(ModifiersBuilders.Background.Builder().setColor(argb(0xFF303030.toInt()))
                    .setCorner(ModifiersBuilders.Corner.Builder().setRadius(dp(28f)).build()).build()).build())
            .addContent(text(recordLabel, 18f, Color.WHITE)).build()
        val content = LayoutElementBuilders.Column.Builder()
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .addContent(text(label, 16f, 0xFFBDBDBD.toInt()))
            .addContent(LayoutElementBuilders.Spacer.Builder().setHeight(dp(12f)).build())
            .addContent(record).build()
        return LayoutElementBuilders.Box.Builder().setWidth(expand()).setHeight(expand())
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setModifiers(ModifiersBuilders.Modifiers.Builder()
                .setBackground(ModifiersBuilders.Background.Builder().setColor(argb(Color.BLACK)).build())
                .setPadding(ModifiersBuilders.Padding.Builder().setAll(dp(20f)).build())
                .setSemantics(ModifiersBuilders.Semantics.Builder().setContentDescription(description).build())
                .setClickable(action).build())
            .addContent(content).build()
    }

    private fun text(value: String, size: Float, color: Int) = LayoutElementBuilders.Text.Builder()
        .setText(value).setMaxLines(1)
        .setFontStyle(LayoutElementBuilders.FontStyle.Builder().setSize(sp(size)).setColor(argb(color)).build())
        .build()
}
