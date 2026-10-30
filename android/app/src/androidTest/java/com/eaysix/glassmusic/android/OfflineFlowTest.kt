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
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.content.ContentValues
import android.provider.MediaStore
import android.os.Build
import androidx.test.platform.app.InstrumentationRegistry

@RunWith(AndroidJUnit4::class)
class OfflineFlowTest {
    @get:Rule val ui = createAndroidComposeRule<MainActivity>()

    // Add a standard FLAC PICTURE block to a private copy of the silent fixture.
    private fun attachSyntheticCover(file: File) {
        val image = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.BLUE) }
        val png = ByteArrayOutputStream().also { image.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        image.recycle()
        val picture = ByteArrayOutputStream()
        DataOutputStream(picture).use { out ->
            out.writeInt(3)
            val mime = "image/png".toByteArray(Charsets.US_ASCII)
            out.writeInt(mime.size); out.write(mime); out.writeInt(0)
            out.writeInt(32); out.writeInt(32); out.writeInt(32); out.writeInt(0)
            out.writeInt(png.size); out.write(png)
        }
        val bytes = file.readBytes()
        check(String(bytes.copyOfRange(0, 4), Charsets.US_ASCII) == "fLaC")
        var offset = 4
        var lastHeader: Int
        do {
            lastHeader = offset
            val last = bytes[offset].toInt() and 128 != 0
            val length = ((bytes[offset + 1].toInt() and 255) shl 16) or ((bytes[offset + 2].toInt() and 255) shl 8) or (bytes[offset + 3].toInt() and 255)
            offset += 4 + length
        } while (!last)
        val metadata = bytes.copyOfRange(0, offset)
        metadata[lastHeader] = (metadata[lastHeader].toInt() and 127).toByte()
        val payload = picture.toByteArray()
        file.outputStream().use { out ->
            out.write(metadata)
            out.write(byteArrayOf(0x86.toByte(), (payload.size shr 16).toByte(), (payload.size shr 8).toByte(), payload.size.toByte()))
            out.write(payload); out.write(bytes, offset, bytes.size - offset)
        }
    }

    private fun screenshot(name: String) {
        if (Build.VERSION.SDK_INT < 29) return
        val context = ui.activity
        val image = requireNotNull(InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot())
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, name)
            put(MediaStore.Images.Media.MIME_TYPE, "image/png")
            put(MediaStore.Images.Media.RELATIVE_PATH, "Pictures/GlassMusic")
        }
        val uri = requireNotNull(context.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values))
        context.contentResolver.openOutputStream(uri)?.use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
        image.recycle()
    }

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
            if (index == 0) attachSyntheticCover(file)
            file.setLastModified(1_600_000_000_000L + index * 1000)
            Uri.fromFile(file)
        }
        val imported = runBlocking { store.importFiles(uris, list.id) }
        assertEquals(2, imported.size)
        val artwork = store.coverFile(store.state.value.songs.first { it.id == imported[0] })
        assertNotNull("Embedded FLAC cover must be imported", artwork)
        val preview = requireNotNull(BitmapFactory.decodeFile(artwork!!.path))
        assertTrue(preview.width <= 512 && preview.height <= 512)
        preview.recycle()
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
        screenshot("player.png")
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
        ui.onNodeWithContentDescription("Cerrar reproductor").performClick()
        ui.onNodeWithText("Inicio").performClick()
        ui.onNodeWithContentDescription("Opciones de playlist").performScrollTo().performClick()
        ui.onNodeWithText("Eliminar playlist").performClick()
        ui.onNodeWithText("Eliminar playlist").performClick()
        ui.waitUntil(5000) { store.state.value.playlists.isEmpty() }
        screenshot("home.png")
        imported.forEach { id -> assertTrue(store.mediaFile(store.state.value.songs.first { it.id == id }).exists()) }
    }
}
