package com.eaysix.glassmusic.android

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LanSyncTest {
    @Test fun pinnedWindowsProtocolDownloadsAndRoundTripsWithoutDuplicateMinutes() = runBlocking(Dispatchers.IO) {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val raw=InstrumentationRegistry.getArguments().getString("hub") ?: error("The real TLS hub fixture is required")
        assertTrue(privateHost("192.168.68.120"));assertTrue(privateHost("10.0.2.2"))
        assertFalse(privateHost("+10.0.0.1"));assertFalse(privateHost("010.0.0.1"));assertFalse(privateHost("8.8.8.8"));assertFalse(privateHost("127.0.0.1"))
        val code=JSONObject(String(Base64.decode(raw,Base64.DEFAULT),Charsets.UTF_8))
        val pair=JSONObject(LanClient(context,code,null,true).json("pair",JSONObject().put("secret",code.getString("secret")).put("deviceName","Android integration")))
        assertEquals(code.getString("serverId"),pair.getString("serverId"))
        code.put("deviceId",pair.getString("deviceId"))
        val client=LanClient(context,code,pair.getString("token"),true)
        val store=LibraryStore.get(context);store.awaitReady()
        val original=store.state.value
        try {
        val sync=PcSync(context,store)
        sync.exchange(client,code,emptyList(),downloadAll=true)
        val song=store.state.value.songs.first{it.id=="first"}
        assertTrue(store.isDownloaded(song));assertEquals(16000.0,song.durationMs.toDouble(),100.0)
        assertTrue(song.lyrics.contains("Hola"))
        val first=store.mediaFile(song)
        assertEquals("fLaC",String(first.inputStream().use{it.readBytesBounded(500000)}.copyOfRange(0,4),Charsets.US_ASCII))
        val list=store.savePlaylist(null,"Desde Android 世界",listOf("first","second"))
        store.favorite("first");store.lyrics("first","[00:01]Desde Android")
        store.recordListening("first",10.0)
        repeat(2){sync.exchange(client,code,emptyList())}
        var manifest=JSONObject(client.json("manifest"))
        assertEquals("Desde Android 世界",manifest.getJSONArray("playlists").objects().first{it.getString("id")==list}.getString("name"))
        assertTrue(manifest.getJSONArray("tracks").objects().first{it.getString("id")=="first"}.getBoolean("favorite"))
        assertEquals("[00:01]Desde Android",JSONObject(client.json("lyrics/first")).getString("text"))
        val source="phone:"+syncObject(store.state.value).getString("sourceId")
        assertEquals(10.0,manifest.getJSONArray("listening").objects().filter{it.getString("source")==source}.sumOf{it.getDouble("seconds")},0.01)
        // A concurrent PC edit must preserve the phone draft and require a choice.
        store.lyrics("first","Borrador Android")
        val before=JSONObject(client.json("lyrics/first"))
        client.json("changes",JSONObject().put("changes",JSONArray().put(JSONObject().put("kind","lyrics").put("id","first").put("baseRevision",before.getString("revision")).put("text","Edición PC"))))
        sync.exchange(client,code,emptyList())
        assertEquals("Borrador Android",store.state.value.songs.first{it.id=="first"}.lyrics)
        assertTrue(syncObject(store.state.value).getJSONArray("conflicts").length()>0)
        store.resolveConflict(0,true);sync.exchange(client,code,emptyList())
        assertEquals("Borrador Android",JSONObject(client.json("lyrics/first")).getString("text"))
        store.deletePlaylist(list);sync.exchange(client,code,emptyList())
        manifest=JSONObject(client.json("manifest"))
        assertFalse(manifest.getJSONArray("playlists").objects().any{it.getString("id")==list})
        assertTrue(first.exists())
        val wrong=JSONObject(code.toString()).put("fingerprint","0".repeat(64))
        assertTrue(runCatching{LanClient(context,wrong,pair.getString("token"),true).json("manifest")}.isFailure)
        store.flush()
        val saved=LibraryStore.decode(LibraryStore.encode(store.state.value))
        assertEquals(store.state.value.sync,saved.sync)
        val vault=LinkVault(context);vault.save("test-token");assertEquals("test-token",vault.read());vault.clear()
        } finally { store.mutate { original }; store.flush() }
    }
}
