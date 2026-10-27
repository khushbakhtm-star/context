package com.context.minuteledger.wear

import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import org.junit.Assert.*
import org.junit.Test

class ContextTileLayoutTest {
    private fun tile() = ContextTileLayout.tile("com.context.minuteledger",
        "com.context.minuteledger.wear.MinuteActivity", "Context", "Record now", "Record the current minute")

    private fun root() = tile().tileTimeline!!.timelineEntries.single().layout!!.root as LayoutElementBuilders.Box

    @Test fun wholeTileLaunchesExactActivityWithOnlyANowAction() {
        val action = root().modifiers!!.clickable!!.onClick as ActionBuilders.LaunchAction
        val activity = action.androidActivity!!
        assertEquals("com.context.minuteledger", activity.packageName)
        assertEquals("com.context.minuteledger.wear.MinuteActivity", activity.className)
        assertEquals(setOf("com.context.minuteledger.action"), activity.keyToExtraMapping.keys)
        assertEquals("com.context.minuteledger.action.RECORD_NOW",
            (activity.keyToExtraMapping[ContextTileLayout.ACTION_EXTRA] as ActionBuilders.AndroidStringExtra).value)
        assertFalse(activity.keyToExtraMapping.containsKey("date"))
        assertFalse(activity.keyToExtraMapping.containsKey("minute"))
    }

    @Test fun tileContainsOnlyStaticLabelsAndMonochromeAccessibleTouchTarget() {
        val outer = root()
        assertTrue(outer.width is DimensionBuilders.ExpandedDimensionProp)
        assertTrue(outer.height is DimensionBuilders.ExpandedDimensionProp)
        assertEquals("Record the current minute", outer.modifiers!!.semantics!!.contentDescription!!.value)
        val column = outer.contents.single() as LayoutElementBuilders.Column
        val label = column.contents[0] as LayoutElementBuilders.Text
        val record = column.contents[2] as LayoutElementBuilders.Box
        val recordLabel = record.contents.single() as LayoutElementBuilders.Text
        assertEquals("Context", label.text!!.value)
        assertEquals("Record now", recordLabel.text!!.value)
        assertTrue((record.height as DimensionBuilders.DpProp).value >= 48f)
        val colors = listOf(outer.modifiers!!.background!!.color!!.argb,
            record.modifiers!!.background!!.color!!.argb, label.fontStyle!!.color!!.argb, recordLabel.fontStyle!!.color!!.argb)
        for (color in colors) {
            assertEquals(color shr 16 and 255, color shr 8 and 255)
            assertEquals(color shr 8 and 255, color and 255)
        }
    }

    @Test fun repeatedTileRequestsHaveNoClockOrPrivateContentAndKeepAStableResourcesVersion() {
        val first = tile(); val second = tile()
        assertEquals(ContextTileLayout.RESOURCES_VERSION, first.resourcesVersion)
        assertEquals(first.toProto(), second.toProto())
        assertEquals(1, first.tileTimeline!!.timelineEntries.size)
        assertNull(first.tileTimeline!!.timelineEntries.single().validity)
    }
}
