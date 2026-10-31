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
    internal val syncManager by lazy { PcSync(context, this) }
    internal fun mutate(edit: (LibraryState) -> LibraryState) = change(edit)
    fun isDownloaded(song: Song): Boolean = song.fileName.isNotEmpty() && runCatching { mediaFile(song).isFile }.getOrDefault(false)

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
        if (next == mutable.value) return
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
    fun favorite(id: String) = change { current ->
        val song = current.songs.firstOrNull { it.id == id } ?: return@change current
        val updated = current.copy(songs = current.songs.map { if (it.id == id) it.copy(favorite = !song.favorite) else it })
        if (song.remoteServer == null) updated else pending(updated, JSONObject().put("kind","favorite").put("id",id).put("value",!song.favorite))
    }
    fun lyrics(id: String, text: String) {
        require(text.toByteArray().size <= 1024 * 1024) { "La letra supera 1 MB." }
        change { current ->
            val song = current.songs.firstOrNull { it.id == id } ?: return@change current
            val updated = current.copy(songs = current.songs.map { if (it.id == id) it.copy(lyrics = text) else it })
            if (song.remoteServer == null) updated else pending(updated, JSONObject().put("kind","lyrics").put("id",id).put("baseRevision",song.lyricsRevision).put("text",text))
        }
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
        queuePlaylist(target)
        return target
    }
    fun addToPlaylist(id: String, ids: List<String>) { change { current ->
        require(current.playlists.any { it.id == id }) { "La playlist ya no existe. Las canciones siguen en la biblioteca." }
        val known = current.songs.map { it.id }.toSet()
        current.copy(playlists = current.playlists.map { if (it.id == id) it.copy(ids = (it.ids + ids).distinct().filter { key -> key in known }) else it })
    }
        queuePlaylist(id)
    }
    fun deletePlaylist(id: String) {
        queuePlaylist(id, deleted = true)
        change { it.copy(playlists = it.playlists.filterNot { list -> list.id == id }) }
    }
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
        writer.execute { removing.forEach { song -> if (song.fileName.isNotEmpty() && state.value.songs.none { it.fileName == song.fileName }) mediaFile(song).delete(); if (state.value.songs.none { it.coverName == song.coverName }) coverFile(song)?.delete() } }
        state.value.playlists.forEach { queuePlaylist(it.id) }
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
                        val options = BitmapFactory.Options().apply { inSampleSize = 1; while (maxOf(bounds.outWidth, bounds.outHeight) / inSampleSize > 512) inSampleSize *= 2 }
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

    internal fun queuePlaylist(id: String, deleted: Boolean = false) = change { current ->
        val list = current.playlists.firstOrNull { it.id == id }
        if (list == null && !deleted) current else {
            val revisions = syncObject(current).optJSONObject("playlistRevisions") ?: JSONObject()
            pending(current, JSONObject().put("kind","playlist").put("id",id).put("name",list?.name ?: "").put("trackIds",JSONArray(list?.ids.orEmpty())).put("deleted",deleted).put("baseRevision",revisions.optional(id) ?: JSONObject.NULL))
        }
    }
    internal fun acknowledge(sent: JSONObject, manifest: JSONObject) = change { current ->
        val sync = syncObject(current)
        val list = sync.optJSONArray("pending")?.objects().orEmpty().filterNot { it.optString("operationId") == sent.optString("operationId") }
        val revision = if (sent.optString("kind") == "lyrics") sha(sent.optString("text").toByteArray()) else
            manifest.optJSONArray("playlists")?.objects()?.firstOrNull { it.optString("id") == sent.optString("id") && it.optString("name") == sent.optString("name") && it.optJSONArray("trackIds")?.toString() == sent.optJSONArray("trackIds")?.toString() }?.optString("revision")
        list.filter { changeKey(it) == changeKey(sent) }.forEach { if (revision != null) it.put("baseRevision",revision) }
        sync.put("pending",JSONArray(list))
        val revisions = sync.optJSONObject("playlistRevisions") ?: JSONObject()
        if (sent.optString("kind") == "playlist" && revision != null) revisions.put(sent.getString("id"), revision)
        sync.put("playlistRevisions",revisions)
        current.copy(sync=sync.toString(), songs=current.songs.map { if (it.id == sent.optString("id") && sent.optString("kind") == "lyrics" && revision != null) it.copy(lyricsRevision=revision) else it })
    }
    internal fun syncConflict(sent: JSONObject, result: JSONObject) = change { current ->
        val s = syncObject(current)
        val list = s.optJSONArray("conflicts")?.objects().orEmpty().filterNot { changeKey(it.getJSONObject("sent")) == changeKey(sent) }
        s.put("conflicts",JSONArray(list + JSONObject().put("sent",sent).put("result",result)))
        current.copy(sync=s.toString())
    }
    internal fun resolveConflict(index: Int, keepLocal: Boolean) = change { current ->
        val s = syncObject(current)
        val conflicts = s.optJSONArray("conflicts")?.objects().orEmpty().toMutableList()
        val conflict = conflicts.getOrNull(index) ?: return@change current
        val sent = conflict.getJSONObject("sent"); val result = conflict.getJSONObject("result")
        val remote = result.optJSONObject("remotePlaylist") ?: result.optJSONObject("conflict")
        if (keepLocal && remote == null) { message.value = result.optString("error", "El cambio sigue pendiente; vuelve a sincronizar."); return@change current }
        conflicts.removeAt(index); s.put("conflicts",JSONArray(conflicts))
        val list = s.optJSONArray("pending")?.objects().orEmpty()
        val queued = list.firstOrNull { changeKey(it) == changeKey(sent) } ?: sent
        var updated = current.copy(sync=s.toString())
        if (keepLocal) {
            queued.put("baseRevision",remote?.optional("revision") ?: JSONObject.NULL)
            updated = pending(updated,queued)
        } else {
            s.put("pending",JSONArray(list.filterNot { changeKey(it) == changeKey(sent) }))
            updated = current.copy(sync=s.toString())
            if (sent.optString("kind") == "lyrics" && remote != null) updated = updated.copy(songs=updated.songs.map { if (it.id==sent.optString("id")) it.copy(lyrics=remote.optString("text"),lyricsRevision=remote.optString("revision")) else it })
            if (sent.optString("kind") == "playlist") {
                val remoteList = remote?.let { Playlist(it.getString("id"),it.getString("name"),it.getJSONArray("trackIds").strings()) }
                updated = updated.copy(playlists=updated.playlists.filterNot { it.id==sent.optString("id") } + listOfNotNull(remoteList))
            }
        }
        updated
    }
    internal fun mergePC(manifest: JSONObject) = change { current ->
        val sync = syncObject(current)
        val pending = sync.optJSONArray("pending")?.objects().orEmpty()
        fun edited(kind: String, id: String) = pending.any { it.optString("kind")==kind && it.optString("id")==id }
        val server = manifest.getString("serverId")
        val old = current.songs.associateBy { it.id }
        val incoming = manifest.getJSONArray("tracks").objects().map { t ->
            val id=t.getString("id"); require(Regex("[a-zA-Z0-9_-]{1,150}").matches(id))
            val was=old[id]
            Song(id,t.getString("title"),t.getString("artist"),t.getString("album"),(t.optDouble("duration",0.0)*1000).toLong().coerceAtLeast(0),t.getString("format"),if(t.isNull("modifiedAt"))null else t.optDouble("modifiedAt").toLong(),
                was?.fileName ?: "",was?.coverName,if(edited("favorite",id))was?.favorite ?: false else t.optBoolean("favorite"),was?.lyrics ?: "",server,t.optional("fileRevision"),was?.fileRevision,was?.lyricsRevision ?: "",if(t.isNull("fileSize"))null else t.optLong("fileSize"),t.optString("lyricsRevision"))
        }
        val ids=incoming.map { it.id }.toSet()
        val lists = manifest.getJSONArray("playlists").objects().map { p ->
            val id=p.getString("id"); val revisions=sync.optJSONObject("playlistRevisions") ?: JSONObject()
            if (!edited("playlist",id)) revisions.put(id,p.getString("revision"))
            sync.put("playlistRevisions",revisions)
            Playlist(id,p.getString("name"),p.getJSONArray("trackIds").strings())
        }
        val deleted=manifest.optJSONArray("deletedPlaylists")?.strings().orEmpty().toSet()
        val remoteIds=lists.map { it.id }.toSet()
        val kept=current.playlists.filter { edited("playlist",it.id) || it.id !in remoteIds && it.id !in deleted }
        sync.put("remoteListening",manifest.optJSONArray("listening") ?: JSONArray())
        sync.put("resumes",manifest.optJSONArray("resumes") ?: JSONArray())
        current.copy(songs=current.songs.filter { it.id !in ids }+incoming, playlists=kept+lists.filterNot { edited("playlist",it.id) },sync=sync.toString())
    }
    internal fun cachePCLyrics(payloads: Map<String, JSONObject>) = change { current ->
        val edits=syncObject(current).optJSONArray("pending")?.objects().orEmpty().filter { it.optString("kind")=="lyrics" }.map { it.optString("id") }.toSet()
        current.copy(songs=current.songs.map { song ->
            val payload=payloads[song.id]
            if(payload==null || song.id in edits) song else song.copy(lyrics=payload.getString("text"),lyricsRevision=payload.getString("revision"))
        })
    }
    internal fun installPC(song: Song, client: LanClient) {
        val temporary=File(audio,"${UUID.randomUUID()}.part")
        try {
            val size=client.download(song,temporary)
            require(song.fileSize==null || size==song.fileSize) { "La descarga está incompleta. Vuelve a intentar." }
            val reader=MediaMetadataRetriever()
            val duration=try { reader.setDataSource(temporary.path); reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: song.durationMs } finally { reader.release() }
            val digest=MessageDigest.getInstance("SHA-256")
            temporary.inputStream().use { input -> DigestInputStream(input,digest).use { stream -> val buffer=ByteArray(64*1024); while(stream.read(buffer)>=0) {} } }
            val hash=digest.digest().joinToString("") { "%02x".format(it.toInt() and 255) }
            val extension=song.format.lowercase(Locale.ROOT); require(extension in setOf("flac","mp3"))
            val name="$hash.$extension"; val destination=File(audio,name)
            if(destination.exists())temporary.delete()else check(temporary.renameTo(destination))
            var cover=song.coverName
            runCatching {
                val bytes=client.image(song.id)
                val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }
                BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                val options=BitmapFactory.Options().apply { inSampleSize=1;while(maxOf(bounds.outWidth,bounds.outHeight)/inSampleSize>512)inSampleSize*=2 }
                BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)?.let { bitmap ->
                    cover=sha(song.id.toByteArray())+".jpg";File(covers,cover!!).outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG,88,it) };bitmap.recycle()
                }
            }
            change { current -> current.copy(songs=current.songs.map { if(it.id==song.id)it.copy(fileName=name,fileRevision=song.remoteRevision,durationMs=duration,coverName=cover)else it }) }
        } finally { temporary.delete() }
    }
    internal fun recordListening(id: String, seconds: Double) {
        if(!seconds.isFinite() || seconds<=0 || seconds>20)return
        val end=java.time.Instant.now();var start=end.minusMillis((seconds*1000).toLong());val zone=java.time.ZoneId.systemDefault()
        change { current ->
            val s=syncObject(current);val entries=s.optJSONArray("listening")?.objects().orEmpty().toMutableList()
            while(start<end) {
                val day=start.atZone(zone).toLocalDate();val boundary=day.plusDays(1).atStartOfDay(zone).toInstant();val stop=if(boundary<end)boundary else end
                val amount=java.time.Duration.between(start,stop).toMillis()/1000.0
                val old=entries.firstOrNull { it.optString("day")==day.toString() && it.optString("trackId")==id }
                if(old!=null)old.put("seconds",(old.optDouble("seconds")+amount).coerceAtMost(86400.0))else entries+=JSONObject().put("day",day.toString()).put("trackId",id).put("seconds",amount)
                start=stop
            }
            s.put("listening",JSONArray(entries));current.copy(sync=s.toString())
        }
    }

    companion object {
        @Volatile private var instance: LibraryStore? = null
        fun get(context: Context): LibraryStore = instance ?: synchronized(this) {
            instance ?: LibraryStore(context.applicationContext).also { instance = it }
        }
        private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
        private fun objects(array: JSONArray?): List<JSONObject> = array?.let { (0 until it.length()).map { index -> it.getJSONObject(index) } } ?: emptyList()
        internal fun encode(state: LibraryState): JSONObject = JSONObject().apply {
            put("schema", 1); put("sync", JSONObject(state.sync))
            put("songs", JSONArray(state.songs.map { s -> JSONObject().apply {
                put("id", s.id); put("title", s.title); put("artist", s.artist); put("album", s.album)
                put("duration", s.durationMs); put("format", s.format); put("modified", s.modifiedAt ?: JSONObject.NULL)
                put("file", s.fileName); put("cover", s.coverName ?: JSONObject.NULL); put("favorite", s.favorite); put("lyrics", s.lyrics); put("remoteServer",s.remoteServer); put("remoteRevision",s.remoteRevision); put("fileRevision",s.fileRevision); put("lyricsRevision",s.lyricsRevision); put("fileSize",s.fileSize); put("remoteLyricsRevision",s.remoteLyricsRevision)
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
                if (s.isNull("cover")) null else s.optString("cover"), s.optBoolean("favorite"), s.optString("lyrics"), s.optional("remoteServer"), s.optional("remoteRevision"), s.optional("fileRevision"), s.optString("lyricsRevision"), if (s.isNull("fileSize")) null else s.optLong("fileSize"), s.optString("remoteLyricsRevision")) }
            val playlists = objects(json.optJSONArray("playlists")).map { Playlist(it.getString("id"), it.getString("name"), it.optJSONArray("ids")?.strings() ?: emptyList()) }
            val q = json.optJSONObject("queue") ?: JSONObject()
            val flags = q.optJSONArray("manual")
            val queue = QueueState(q.optJSONArray("ids")?.strings() ?: emptyList(), flags?.let { (0 until it.length()).map { i -> flags.optBoolean(i) } } ?: emptyList(),
                q.optInt("index"), q.optLong("position").coerceAtLeast(0), q.optBoolean("shuffle"), q.optInt("repeat").coerceIn(0, 2))
            val a = json.optJSONObject("appearance") ?: JSONObject()
            return LibraryState(ready = true, songs = songs, sync = json.optJSONObject("sync")?.toString() ?: LibraryState().sync, playlists = playlists, queue = queue, appearance = Appearance(a.optString("name", "Mi espacio"), a.optLong("accent", 0xFF8CCDF3),
                a.optBoolean("animated", true), a.optDouble("scale", 1.0).toFloat().coerceIn(0.85f, 1.25f), a.optBoolean("newest"), a.optDouble("volume", 0.8).toFloat().coerceIn(0f, 1f)))
        }
    }
}
