package com.eaysix.glassmusic.android

data class Song(
    val id: String, val title: String, val artist: String, val album: String,
    val durationMs: Long, val format: String, val modifiedAt: Long?,
    val fileName: String, val coverName: String? = null, val favorite: Boolean = false,
    val lyrics: String = "", val remoteServer: String? = null, val remoteRevision: String? = null,
    val fileRevision: String? = null, val lyricsRevision: String = "", val fileSize: Long? = null,
)
data class Playlist(val id: String, val name: String, val ids: List<String>)
data class QueueState(
    val ids: List<String> = emptyList(), val manual: List<Boolean> = emptyList(),
    val index: Int = 0, val position: Long = 0, val shuffle: Boolean = false, val repeat: Int = 0,
)
data class Appearance(val name: String = "Mi espacio", val accent: Long = 0xFF8CCDF3,
    val animated: Boolean = true, val scale: Float = 1f, val newest: Boolean = false, val volume: Float = 0.8f)
data class LibraryState(val ready: Boolean = false, val songs: List<Song> = emptyList(),
    val sync: String = "{\"sourceId\":\"${java.util.UUID.randomUUID()}\"}",
    val playlists: List<Playlist> = emptyList(), val queue: QueueState = QueueState(), val appearance: Appearance = Appearance())

fun orderedSongs(songs: List<Song>, newest: Boolean): List<Song> = songs.sortedWith(
    compareBy<Song> { it.modifiedAt == null }.thenComparator { a, b ->
        val date = (a.modifiedAt ?: 0).compareTo(b.modifiedAt ?: 0)
        (if (newest) -date else date).takeIf { it != 0 } ?: a.title.compareTo(b.title, ignoreCase = true)
    },
)
fun manualInsertionIndex(current: Int, flags: List<Boolean>): Int {
    var index = (current + 1).coerceAtLeast(0)
    while (index < flags.size && flags[index]) index++
    return index.coerceAtMost(flags.size)
}
fun clock(ms: Long): String {
    val seconds = ms.coerceAtLeast(0) / 1000
    return "%d:%02d".format(java.util.Locale.ROOT, seconds / 60, seconds % 60)
}
data class LyricLine(val timeMs: Long, val text: String)
fun parseLyrics(raw: String): List<LyricLine> {
    val stamp = Regex("\\[(\\d+):(\\d+(?:\\.\\d+)?)\\]")
    val offset = Regex("\\[offset:([+-]?\\d+)\\]", RegexOption.IGNORE_CASE).find(raw)?.groupValues?.get(1)?.toLongOrNull() ?: 0
    return raw.lineSequence().flatMap { line ->
        val text = line.replace(stamp, "").replace(Regex("<\\d+:\\d+(?:\\.\\d+)?>"), "").trim()
        stamp.findAll(line).mapNotNull { match ->
            val minutes = match.groupValues[1].toDoubleOrNull() ?: return@mapNotNull null
            val seconds = match.groupValues[2].toDoubleOrNull() ?: return@mapNotNull null
            val time = minutes * 60_000 + seconds * 1000 + offset
            if (!time.isFinite() || time > Long.MAX_VALUE) null else LyricLine(time.toLong().coerceAtLeast(0), text)
        }
    }.sortedBy { it.timeMs }.toList()
}
