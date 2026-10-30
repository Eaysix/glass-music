package com.eaysix.glassmusic.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.AtomicFile
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.DigestInputStream
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID
import java.util.concurrent.Executors

class LibraryStore private constructor(private val context: Context) {
    private val root = File(context.filesDir, "glass-music").apply { mkdirs() }
    private val audio = File(root, "Audio").apply { mkdirs() }
    private val covers = File(root, "Covers").apply { mkdirs() }
    private val file = AtomicFile(File(root, "library.json"))
    private val writer = Executors.newSingleThreadExecutor()
    private val loaded = CompletableDeferred<Unit>()
    private val mutable = MutableStateFlow(LibraryState())
    val state = mutable.asStateFlow()
    val message = MutableStateFlow<String?>(null)

    init {
        writer.execute {
            try {
                val json = file.openRead().bufferedReader().use { it.readText() }
                mutable.value = decode(JSONObject(json)).copy(ready = true)
            } catch (_: java.io.FileNotFoundException) { mutable.value = LibraryState(ready = true) }
            catch (error: Exception) {
                // Preserve an unreadable snapshot before creating a fresh one.
                runCatching { file.baseFile.copyTo(File(root, "library-${System.currentTimeMillis()}.recovery.json")) }
                message.value = "No se pudo leer la biblioteca anterior. Se conservó una copia de recuperación."
                mutable.value = LibraryState(ready = true)
            } finally { loaded.complete(Unit) }
        }
    }
    suspend fun awaitReady() = loaded.await()
    @Synchronized private fun change(edit: (LibraryState) -> LibraryState) {
        check(mutable.value.ready) { "Espera a que abra la biblioteca." }
        val next = edit(mutable.value)
        mutable.value = next
        writer.execute {
            var output: java.io.FileOutputStream? = null
            try {
                output = file.startWrite()
                output.write(encode(next).toString().toByteArray(Charsets.UTF_8))
                file.finishWrite(output)
            } catch (_: Exception) { file.failWrite(output); message.value = "No se pudieron guardar los últimos cambios. Revisa el espacio disponible." }
        }
    }
    fun mediaFile(song: Song): File {
        require(Regex("[a-f0-9]{64}\\.(flac|mp3)").matches(song.fileName))
        return File(audio, song.fileName)
    }
    fun coverFile(song: Song): File? = song.coverName?.takeIf { Regex("[a-f0-9]{64}\\.jpg").matches(it) }?.let { File(covers, it) }
    fun appearance(edit: (Appearance) -> Appearance) = change { it.copy(appearance = edit(it.appearance)) }
    fun saveQueue(queue: QueueState) = change { current ->
        val known = current.songs.map { it.id }.toSet()
        if (queue.ids.any { it !in known }) current else current.copy(queue = queue)
    }
    fun favorite(id: String) = change { it.copy(songs = it.songs.map { s -> if (s.id == id) s.copy(favorite = !s.favorite) else s }) }
    fun lyrics(id: String, text: String) {
        require(text.toByteArray().size <= 1024 * 1024) { "La letra supera 1 MB." }
        change { it.copy(songs = it.songs.map { song -> if (song.id == id) song.copy(lyrics = text) else song }) }
    }
    fun savePlaylist(id: String?, name: String, ids: List<String>): String {
        require(name.isNotBlank()) { "Escribe un nombre." }
        val target = id ?: UUID.randomUUID().toString()
        change { current ->
            require(id == null || current.playlists.any { it.id == id }) { "La playlist ya no existe." }
            val known = current.songs.map { it.id }.toSet()
            val playlist = Playlist(target, name.trim().take(100), ids.distinct().filter { it in known })
            current.copy(playlists = if (id == null) current.playlists + playlist else current.playlists.map { if (it.id == id) playlist else it })
        }
        return target
    }
    fun addToPlaylist(id: String, ids: List<String>) = change { current ->
        require(current.playlists.any { it.id == id }) { "La playlist ya no existe. Las canciones siguen en la biblioteca." }
        val known = current.songs.map { it.id }.toSet()
        current.copy(playlists = current.playlists.map { if (it.id == id) it.copy(ids = (it.ids + ids).distinct().filter { key -> key in known }) else it })
    }
    fun deletePlaylist(id: String) = change { it.copy(playlists = it.playlists.filterNot { list -> list.id == id }) }
    fun removeSongs(ids: Set<String>) {
        val removing = state.value.songs.filter { it.id in ids }
        change { current ->
            val q = current.queue
            val kept = q.ids.indices.filter { q.ids[it] !in ids }
            val oldId = q.ids.getOrNull(q.index)
            val queue = q.copy(ids = kept.map { q.ids[it] }, manual = kept.map { q.manual.getOrNull(it) ?: false },
                index = kept.indexOf(q.index).takeIf { it >= 0 } ?: q.index.coerceAtMost((kept.size - 1).coerceAtLeast(0)),
                position = if (oldId in ids) 0 else q.position)
            current.copy(songs = current.songs.filterNot { song -> song.id in ids },
                playlists = current.playlists.map { list -> list.copy(ids = list.ids.filterNot { key -> key in ids }) }, queue = queue)
        }
        writer.execute { removing.forEach { song -> mediaFile(song).delete(); coverFile(song)?.delete() } }
    }
    suspend fun importFiles(uris: List<Uri>, target: String? = null): List<String> = withContext(Dispatchers.IO) {
        awaitReady()
        val imported = mutableListOf<String>()
        for (uri in uris) {
            val temporary = File(audio, "${UUID.randomUUID()}.part")
            try {
                var name = uri.lastPathSegment ?: "Canción"
                var modified: Long? = null
                if (uri.scheme == "file") { name = File(requireNotNull(uri.path)).name; modified = File(requireNotNull(uri.path)).lastModified().takeIf { it > 0 } }
                else runCatching {
                    context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                        if (cursor.moveToFirst()) {
                            val n = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                            val m = cursor.getColumnIndex(DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                            if (n >= 0) name = cursor.getString(n)
                            if (m >= 0 && !cursor.isNull(m)) modified = cursor.getLong(m).takeIf { it > 0 }
                        }
                    }
                }
                val format = name.substringAfterLast('.', "").uppercase(Locale.ROOT)
                require(format in setOf("FLAC", "MP3")) { "$name: elige archivos FLAC o MP3." }
                val digest = MessageDigest.getInstance("SHA-256")
                requireNotNull(context.contentResolver.openInputStream(uri)) { "No se pudo abrir $name." }.use { input ->
                    DigestInputStream(input, digest).use { stream -> temporary.outputStream().use { output -> stream.copyTo(output, 64 * 1024) } }
                }
                val id = digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
                if (state.value.songs.any { it.id == id }) { imported += id; continue }
                val reader = MediaMetadataRetriever()
                val song: Song
                try {
                    reader.setDataSource(temporary.absolutePath)
                    fun tag(key: Int, fallback: String) = reader.extractMetadata(key)?.takeIf { it.isNotBlank() } ?: fallback
                    val picture = reader.embeddedPicture
                    var cover: String? = null
                    if (picture != null && picture.size <= 12 * 1024 * 1024) {
                        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                        BitmapFactory.decodeByteArray(picture, 0, picture.size, bounds)
                        val options = BitmapFactory.Options().apply { while (maxOf(bounds.outWidth, bounds.outHeight) / inSampleSize > 512) inSampleSize *= 2 }
                        BitmapFactory.decodeByteArray(picture, 0, picture.size, options)?.let { bitmap ->
                            cover = "$id.jpg"
                            File(covers, cover!!).outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 88, it) }
                            bitmap.recycle()
                        }
                    }
                    song = Song(id, tag(MediaMetadataRetriever.METADATA_KEY_TITLE, name.substringBeforeLast('.')),
                        tag(MediaMetadataRetriever.METADATA_KEY_ARTIST, "Artista desconocido"), tag(MediaMetadataRetriever.METADATA_KEY_ALBUM, "Sin álbum"),
                        reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.coerceAtLeast(0) ?: 0,
                        format, modified, "$id.${format.lowercase(Locale.ROOT)}", cover)
                } finally { reader.release() }
                check(temporary.renameTo(mediaFile(song))) { "No se pudo guardar $name. Revisa el espacio disponible." }
                change { it.copy(songs = if (it.songs.any { s -> s.id == id }) it.songs else it.songs + song) }
                imported += id
            } catch (error: Exception) {
                if (error is kotlinx.coroutines.CancellationException) throw error
                message.value = error.message ?: "No se pudo importar este archivo."
            } finally { temporary.delete() }
        }
        if (target != null && imported.isNotEmpty()) runCatching { addToPlaylist(target, imported) }.onFailure { message.value = it.message }
        imported.distinct()
    }
    // Used by instrumentation after real imports to verify the persisted snapshot.
    suspend fun flush() = withContext(Dispatchers.IO) { writer.submit {}.get() }

    companion object {
        @Volatile private var instance: LibraryStore? = null
        fun get(context: Context): LibraryStore = instance ?: synchronized(this) {
            instance ?: LibraryStore(context.applicationContext).also { instance = it }
        }
        private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
        private fun objects(array: JSONArray?): List<JSONObject> = array?.let { (0 until it.length()).map { index -> it.getJSONObject(index) } } ?: emptyList()
        internal fun encode(state: LibraryState): JSONObject = JSONObject().apply {
            put("schema", 1)
            put("songs", JSONArray(state.songs.map { s -> JSONObject().apply {
                put("id", s.id); put("title", s.title); put("artist", s.artist); put("album", s.album)
                put("duration", s.durationMs); put("format", s.format); put("modified", s.modifiedAt ?: JSONObject.NULL)
                put("file", s.fileName); put("cover", s.coverName ?: JSONObject.NULL); put("favorite", s.favorite); put("lyrics", s.lyrics)
            } }))
            put("playlists", JSONArray(state.playlists.map { JSONObject().put("id", it.id).put("name", it.name).put("ids", JSONArray(it.ids)) }))
            val q = state.queue
            put("queue", JSONObject().put("ids", JSONArray(q.ids)).put("manual", JSONArray(q.manual)).put("index", q.index).put("position", q.position).put("shuffle", q.shuffle).put("repeat", q.repeat))
            val a = state.appearance
            put("appearance", JSONObject().put("name", a.name).put("accent", a.accent).put("animated", a.animated).put("scale", a.scale).put("newest", a.newest).put("volume", a.volume))
        }
        internal fun decode(json: JSONObject): LibraryState {
            require(json.optInt("schema", 1) == 1) { "Versión de biblioteca desconocida." }
            val songs = objects(json.optJSONArray("songs")).map { s -> Song(s.getString("id"), s.getString("title"), s.optString("artist"), s.optString("album"),
                s.optLong("duration"), s.optString("format"), if (s.isNull("modified")) null else s.optLong("modified"), s.getString("file"),
                if (s.isNull("cover")) null else s.optString("cover"), s.optBoolean("favorite"), s.optString("lyrics")) }
            val playlists = objects(json.optJSONArray("playlists")).map { Playlist(it.getString("id"), it.getString("name"), it.optJSONArray("ids")?.strings() ?: emptyList()) }
            val q = json.optJSONObject("queue") ?: JSONObject()
            val flags = q.optJSONArray("manual")
            val queue = QueueState(q.optJSONArray("ids")?.strings() ?: emptyList(), flags?.let { (0 until it.length()).map { i -> flags.optBoolean(i) } } ?: emptyList(),
                q.optInt("index"), q.optLong("position").coerceAtLeast(0), q.optBoolean("shuffle"), q.optInt("repeat").coerceIn(0, 2))
            val a = json.optJSONObject("appearance") ?: JSONObject()
            return LibraryState(true, songs, playlists, queue, Appearance(a.optString("name", "Mi espacio"), a.optLong("accent", 0xFF8CCDF3),
                a.optBoolean("animated", true), a.optDouble("scale", 1.0).toFloat().coerceIn(0.85f, 1.25f), a.optBoolean("newest"), a.optDouble("volume", 0.8).toFloat().coerceIn(0f, 1f)))
        }
    }
}
