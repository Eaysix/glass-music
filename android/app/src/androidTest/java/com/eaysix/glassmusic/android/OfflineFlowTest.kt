package com.eaysix.glassmusic.android

import android.net.Uri
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class OfflineFlowTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    @Test fun importsPlaylistRealAudioEndOfTrackLyricsAndDeletion() {
        val activity = ui.activity
        val store = LibraryStore.get(activity)
        runBlocking { store.awaitReady() }
        store.appearance { it.copy(animated = false) }
        ui.onNodeWithTag("create-playlist").performClick()
        ui.onNodeWithTag("playlist-name").performTextInput("Prueba Android")
        ui.onNodeWithTag("import-playlist").assertExists()
        ui.onNodeWithTag("save-playlist").performClick()
        ui.waitUntil(5000) { store.state.value.playlists.size == 1 }
        val list = store.state.value.playlists.single()
        val uris = listOf("first.flac", "second.mp3").mapIndexed { index, name ->
            val file = File(activity.cacheDir, name)
            activity.assets.open(name).use { input -> file.outputStream().use { input.copyTo(it) } }
            file.setLastModified(1_600_000_000_000L + index * 1000)
            Uri.fromFile(file)
        }
        val imported = runBlocking { store.importFiles(uris, list.id) }
        assertEquals(2, imported.size)
        assertEquals(imported, store.state.value.playlists.single().ids)
        runBlocking { store.importFiles(uris, list.id) }
        assertEquals(2, store.state.value.songs.size)
        assertEquals(2, store.state.value.playlists.single().ids.size)
        ui.onNodeWithText("Prueba Android").performClick()
        ui.onNodeWithTag("import-collection").assertIsDisplayed()
        ui.onNodeWithTag("play-${imported[0]}").performClick()
        ui.waitUntil(15_000) { activity.playback.state.value.let { it.id == imported[0] && it.duration > 15_000 && it.playing } }
        ui.onNodeWithTag("mini-player").performClick()
        ui.runOnIdle { activity.playback.seek(activity.playback.state.value.duration) }
        ui.waitUntil(10_000) { activity.playback.state.value.let { it.id == imported[1] && it.position < 4000 && it.duration > 15_000 } }
        ui.runOnIdle { activity.playback.player?.pause() }
        ui.waitUntil(5000) { !activity.playback.state.value.playing }
        ui.runOnIdle { activity.playback.seek(8000) }
        ui.waitUntil(5000) { activity.playback.state.value.position in 7500..8500 }
        assertFalse(activity.playback.state.value.playing)
        ui.onNodeWithText("Editar letra").performScrollTo().performClick()
        ui.onNodeWithTag("lyrics-text").performTextInput("[00:01]Hola Android\n[00:03]Sigue la música")
        ui.onNodeWithText("Guardar letra").performClick()
        runBlocking { store.flush() }
        val saved = LibraryStore.decode(JSONObject(File(activity.filesDir, "glass-music/library.json").readText()))
        assertTrue(saved.songs.first { it.id == imported[1] }.lyrics.contains("Hola Android"))
        assertEquals(imported, saved.playlists.single().ids)
        assertEquals(imported[1], saved.queue.ids[saved.queue.index])
        assertTrue(saved.queue.position in 7500..8500)
        ui.activityRule.scenario.recreate()
        ui.waitUntil(10_000) { ui.activity.playback.state.value.let { it.connected && it.id == imported[1] && !it.playing } }
        ui.onNodeWithContentDescription("Opciones de playlist").performClick()
        ui.onNodeWithText("Eliminar playlist").performClick()
        ui.onNodeWithText("Eliminar playlist").performClick()
        ui.waitUntil(5000) { store.state.value.playlists.isEmpty() }
        imported.forEach { id -> assertTrue(store.mediaFile(store.state.value.songs.first { it.id == id }).exists()) }
    }
}
