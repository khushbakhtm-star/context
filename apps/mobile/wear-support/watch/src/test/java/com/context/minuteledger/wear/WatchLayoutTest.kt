package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test

class WatchLayoutTest {
    @Test fun smallRoundScreensKeepMoreThanTwoMinuteRowsVisible() {
        for (height in listOf(198, 220, 224)) assertTrue(WatchLayout.ledgerViewport(height) >= 2 * WatchLayout.MINUTE)
        assertEquals(132, WatchLayout.ledgerViewport(198))
    }
    @Test fun editorTextHasARealViewportOnSmallScreens() {
        for (height in listOf(198, 220, 224)) assertTrue(WatchLayout.editorViewport(height) >= WatchLayout.editorBodyHeight())
    }
    @Test fun resizedEditorKeepsFixedSaveRowAndScrollsBody() {
        assertTrue(WatchLayout.editorViewport(100) > 0)
        assertTrue(WatchLayout.editorViewport(100) < WatchLayout.TEXT_FIELD)
    }
}
