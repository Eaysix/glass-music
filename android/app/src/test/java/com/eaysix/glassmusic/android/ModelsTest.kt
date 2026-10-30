package com.eaysix.glassmusic.android

import org.junit.Assert.*
import org.junit.Test

class ModelsTest {
    private fun song(id: String, date: Long?) = Song(id, id, "", "", 16_000, "FLAC", date, "$id.flac")
    @Test fun modificationOrderKeepsUnknownDatesLastInBothDirections() {
        val songs = listOf(song("unknown", null), song("new", 2000), song("old", 1000))
        assertEquals(listOf("old", "new", "unknown"), orderedSongs(songs, false).map { it.id })
        assertEquals(listOf("new", "old", "unknown"), orderedSongs(songs, true).map { it.id })
    }
    @Test fun manualQueueIsFifoBeforeTheAutomaticContext() {
        assertEquals(3, manualInsertionIndex(0, listOf(false, true, true, false)))
        assertEquals(3, manualInsertionIndex(1, listOf(false, true, true, false)))
        assertEquals(0, manualInsertionIndex(-1, emptyList()))
    }
    @Test fun lyricsKeepRepeatedVersesAndApplyOffsets() {
        val lines = parseLyrics("[offset:-500]\n[00:01][00:04]Hola\n[00:03]Otra")
        assertEquals(listOf(500L, 2500L, 3500L), lines.map { it.timeMs })
        assertEquals(listOf("Hola", "Otra", "Hola"), lines.map { it.text })
    }
    @Test fun malformedAndPlainLyricsDoNotCrashTheParser() {
        assertTrue(parseLyrics("Sin tiempos").isEmpty())
        assertTrue(parseLyrics("[${"9".repeat(400)}:00]Texto").isEmpty())
    }
    @Test fun playbackClockDoesNotWrapAtOneHourOrGoNegative() {
        assertEquals("0:00", clock(-500))
        assertEquals("61:02", clock(3_662_000))
    }
}
