package com.context.minuteledger.wear

import org.junit.Assert.*
import org.junit.Test

class JVMWatchCardLayoutTest {
    @Test fun controlsKeepFullTouchTargetsAndNegativeSpaceOnSmallRoundScreens() {
        for (width in listOf(198, 220, 224)) {
            assertEquals(44, WatchCardLayout.ACTION_TARGET)
            assertTrue(WatchCardLayout.actionSideSpace(width) >= 30)
            assertTrue(WatchCardLayout.ACTION_CIRCLE < WatchCardLayout.ACTION_TARGET)
            assertTrue(WatchCardLayout.ACTION_ICON < WatchCardLayout.ACTION_CIRCLE)
        }
    }

    @Test fun anEmptyOrFullyVisibleListHasNoMisleadingScrollThumb() {
        assertNull(WatchCardLayout.scrollThumb(0, 0, 1440))
        assertNull(WatchCardLayout.scrollThumb(0, 2, 0))
        assertNull(WatchCardLayout.scrollThumb(0, 1440, 1440))
        assertNull(WatchCardLayout.scrollThumb(0, 1441, 1440))
    }

    @Test fun invalidCoordinatesAndNonFiniteFractionsNeverReachCanvas() {
        assertNull(WatchCardLayout.scrollThumb(-1, 2, 1440))
        assertNull(WatchCardLayout.scrollThumb(1440, 2, 1440))
        assertNull(WatchCardLayout.scrollThumb(0, 2, 1440, Float.NaN))
        assertNull(WatchCardLayout.scrollThumb(0, 2, 1440, Float.POSITIVE_INFINITY))
    }

    @Test fun midnightPlacesReadableThumbAtTrackStart() {
        val thumb = WatchCardLayout.scrollThumb(0, 2, 1440)!!
        assertEquals(WatchCardLayout.ARC_START, thumb.start, 0.0001f)
        assertEquals(WatchCardLayout.MIN_THUMB_SWEEP, thumb.sweep, 0.0001f)
    }

    @Test fun finalMinuteWindowReachesTheExactTrackEnd() {
        val thumb = WatchCardLayout.scrollThumb(1438, 2, 1440)!!
        assertEquals(WatchCardLayout.ARC_START + WatchCardLayout.ARC_SWEEP,
            thumb.start + thumb.sweep, 0.0001f)
    }

    @Test fun aPartiallyHiddenFirstCardMovesTheThumbContinuously() {
        val before = WatchCardLayout.scrollThumb(720, 3, 1440, 0f)!!
        val partial = WatchCardLayout.scrollThumb(720, 3, 1440, 0.5f)!!
        val next = WatchCardLayout.scrollThumb(721, 3, 1440, 0f)!!
        assertTrue(before.start < partial.start)
        assertTrue(partial.start < next.start)
    }

    @Test fun allMinuteWindowsStayWithinTrackBounds() {
        for (first in 0 until 1440) for (fraction in listOf(0f, 0.25f, 0.75f, 1f)) {
            val thumb = WatchCardLayout.scrollThumb(first, 3, 1440, fraction)!!
            assertTrue(thumb.start >= WatchCardLayout.ARC_START - 0.0001f)
            assertTrue(thumb.sweep >= WatchCardLayout.MIN_THUMB_SWEEP)
            assertTrue(thumb.start + thumb.sweep <= WatchCardLayout.ARC_START + WatchCardLayout.ARC_SWEEP + 0.0001f)
        }
    }

    @Test fun largerVisibleWindowsReceiveProportionallyLargerThumbs() {
        val small = WatchCardLayout.scrollThumb(0, 2, 1440)!!
        val large = WatchCardLayout.scrollThumb(0, 500, 1440)!!
        assertTrue(large.sweep > small.sweep)
        assertEquals(WatchCardLayout.ARC_SWEEP * 500 / 1440, large.sweep, 0.0001f)
    }
}
