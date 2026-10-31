package com.eaysix.glassmusic.android

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

internal object LyricsSearch {
    private val mutex=Mutex()
    private var next=0L
    private val cache=LinkedHashMap<String,List<JSONObject>>()
    suspend fun search(song: Song): List<JSONObject> = withContext(Dispatchers.IO) { mutex.withLock {
        val query="track_name="+URLEncoder.encode(song.title,"UTF-8")+"&artist_name="+URLEncoder.encode(song.artist,"UTF-8")
        cache[query]?.let{return@withLock it}
        require(System.currentTimeMillis()>=next){"Espera antes de volver a buscar letras."}
        next=System.currentTimeMillis()+800
        val c=URL("https://lrclib.net/api/search?$query").openConnection() as HttpURLConnection
        c.connectTimeout=20000;c.readTimeout=20000;c.instanceFollowRedirects=false
        c.setRequestProperty("Lrclib-Client","Glass Music Android 0.2.0 (https://github.com/Eaysix/glass-music)")
        try {
            if(c.responseCode==429 || c.responseCode==503) {
                val delay=(c.getHeaderField("Retry-After")?.toLongOrNull() ?: 60).coerceAtLeast(1)
                next=System.currentTimeMillis()+delay*1000+500
                error("LRCLIB está ocupado. Espera antes de volver a buscar.")
            }
            check(c.responseCode in 200..299){"LRCLIB no pudo responder (${c.responseCode})."}
            val raw=c.inputStream.use{String(it.readBytesBounded(4*1024*1024),Charsets.UTF_8)}
            val results=JSONArray(raw).objects().filter{lyricsText(it).isNotEmpty()}.take(20)
            if(cache.size>=100)cache.remove(cache.keys.first())
            cache[query]=results;results
        } finally {c.disconnect()}
    } }
}
internal fun lyricsText(j: JSONObject)=j.optional("syncedLyrics") ?: j.optional("plainLyrics") ?: ""
