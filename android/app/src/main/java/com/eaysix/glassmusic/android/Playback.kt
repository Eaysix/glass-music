package com.eaysix.glassmusic.android

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaController
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

internal fun Song.item(store: LibraryStore, manual: Boolean = false): MediaItem = MediaItem.Builder()
    .setMediaId(id).setUri(Uri.fromFile(store.mediaFile(this)))
    .setMediaMetadata(MediaMetadata.Builder().setTitle(title).setArtist(artist).setAlbumTitle(album)
        .setArtworkUri(store.coverFile(this)?.let(Uri::fromFile))
        .setExtras(Bundle().apply { putBoolean("manual", manual) }).build()).build()

@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private lateinit var store: LibraryStore
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handler = Handler(Looper.getMainLooper())
    private var restoring = true
    private val checkpoint = object : Runnable {
        override fun run() { persist(); if (session?.player?.isPlaying == true) handler.postDelayed(this, 10_000) }
    }
    override fun onCreate() {
        super.onCreate()
        store = LibraryStore.get(this)
        val player = ExoPlayer.Builder(this).build().apply {
            setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            setHandleAudioBecomingNoisy(true)
            setWakeMode(C.WAKE_MODE_LOCAL)
            addListener(object : Player.Listener {
                override fun onEvents(player: Player, events: Player.Events) {
                    if (!restoring) persist()
                    handler.removeCallbacks(checkpoint)
                    if (player.isPlaying) handler.postDelayed(checkpoint, 10_000)
                }
                override fun onPlayerError(error: PlaybackException) {
                    store.message.value = "No se pudo reproducir este archivo. Prueba otra canción o vuelve a importarlo."
                }
            })
        }
        session = MediaSession.Builder(this, player).setSessionActivity(PendingIntent.getActivity(this, 0,
            Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            .setCallback(object : MediaSession.Callback {
                override fun onAddMediaItems(mediaSession: MediaSession, controller: MediaSession.ControllerInfo, mediaItems: List<MediaItem>): ListenableFuture<List<MediaItem>> {
                    val songs = store.state.value.songs.associateBy { it.id }
                    // Only catalogued private audio can be played, including commands from other controllers.
                    return Futures.immediateFuture(mediaItems.mapNotNull { item -> songs[item.mediaId]?.item(store, item.mediaMetadata.extras?.getBoolean("manual") == true) })
                }
            }).build()
        scope.launch {
            store.awaitReady()
            val snapshot = store.state.value
            val songs = snapshot.songs.associateBy { it.id }
            val queue = snapshot.queue
            val restored = queue.ids.mapIndexedNotNull { i, id -> songs[id]?.item(store, queue.manual.getOrNull(i) == true) }
            player.volume = snapshot.appearance.volume
            if (restored.isNotEmpty()) {
                player.setMediaItems(restored, queue.index.coerceIn(0, restored.lastIndex), queue.position.coerceAtLeast(0))
                player.repeatMode = queue.repeat
                player.prepare()
            }
            // The saved physical order already includes shuffle and manual FIFO.
            player.shuffleModeEnabled = false
            player.playWhenReady = false
            restoring = false
        }
    }
    private fun persist() {
        if (restoring || !store.state.value.ready) return
        val player = session?.player ?: return
        val ids = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaId }
        val manual = (0 until player.mediaItemCount).map { player.getMediaItemAt(it).mediaMetadata.extras?.getBoolean("manual") == true }
        store.saveQueue(QueueState(ids, manual, player.currentMediaItemIndex.coerceAtLeast(0),
            player.currentPosition.coerceAtLeast(0), store.state.value.queue.shuffle, player.repeatMode))
    }
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session
    override fun onDestroy() {
        persist(); handler.removeCallbacksAndMessages(null); scope.cancel()
        session?.let { it.player.release(); it.release() }; session = null
        super.onDestroy()
    }
}

data class TransportState(val connected: Boolean = false, val id: String? = null, val playing: Boolean = false,
    val position: Long = 0, val duration: Long = 0, val upcoming: List<String> = emptyList(), val repeat: Int = 0)

@androidx.annotation.OptIn(UnstableApi::class)
class PlaybackClient(context: Context, private val store: LibraryStore) {
    private val handler = Handler(Looper.getMainLooper())
    private var visible = false
    private val future = MediaController.Builder(context, SessionToken(context, ComponentName(context, PlaybackService::class.java))).buildAsync()
    var player: MediaController? = null
        private set
    private val mutable = MutableStateFlow(TransportState())
    val state = mutable.asStateFlow()
    private val tick = object : Runnable {
        override fun run() { publish(); if (visible && player?.isPlaying == true) handler.postDelayed(this, 250) }
    }
    init {
        future.addListener({
            runCatching {
                player = future.get()
                player?.addListener(object : Player.Listener {
                    override fun onEvents(player: Player, events: Player.Events) { publish(); schedule() }
                    override fun onPlayerError(error: PlaybackException) { store.message.value = "No se pudo reproducir este archivo." }
                })
                publish(); schedule()
            }.onFailure { store.message.value = "No se pudo conectar el reproductor. Cierra y vuelve a abrir la app." }
        }, ContextCompat.getMainExecutor(context))
    }
    private fun schedule() { handler.removeCallbacks(tick); if (visible && player?.isPlaying == true) handler.post(tick) }
    fun visible(value: Boolean) { visible = value; publish(); schedule() }
    fun publish() {
        val p = player ?: return
        val id = p.currentMediaItem?.mediaId
        val fallback = store.state.value.songs.firstOrNull { it.id == id }?.durationMs ?: 0
        val duration = p.duration.takeIf { it > 0 } ?: fallback
        mutable.value = TransportState(true, id, p.playWhenReady && p.playbackState != Player.STATE_ENDED,
            p.currentPosition.coerceAtLeast(0).let { if (duration > 0) it.coerceAtMost(duration) else it }, duration,
            ((p.currentMediaItemIndex + 1).coerceAtLeast(0) until p.mediaItemCount).map { p.getMediaItemAt(it).mediaId }, p.repeatMode)
    }
    fun play(id: String, context: List<String>) {
        val p = player ?: return
        val byId = store.state.value.songs.associateBy { it.id }
        val available = context.distinct().mapNotNull { byId[it] }.filter { store.mediaFile(it).exists() }
        if (available.none { it.id == id }) return
        val ordered = if (store.state.value.queue.shuffle) available.filter { it.id == id } + available.filter { it.id != id }.shuffled() else available
        p.setMediaItems(ordered.map { it.item(store) }, ordered.indexOfFirst { it.id == id }, 0)
        p.prepare(); p.play(); publish()
    }
    fun toggle() {
        val p = player ?: return
        if (p.playWhenReady && p.playbackState != Player.STATE_ENDED) p.pause()
        else if (p.mediaItemCount > 0) {
            if (p.playbackState == Player.STATE_ENDED) p.seekTo(0)
            if (p.playbackState == Player.STATE_IDLE) p.prepare()
            p.play()
        } else orderedSongs(store.state.value.songs, store.state.value.appearance.newest).firstOrNull()?.let { play(it.id, store.state.value.songs.map { s -> s.id }) }
        publish()
    }
    fun seek(position: Long) { player?.seekTo(position.coerceIn(0, state.value.duration.coerceAtLeast(0))); publish() }
    fun next() { player?.seekToNextMediaItem(); publish() }
    fun previous() {
        val p = player ?: return
        if (p.currentPosition > 3000 || !p.hasPreviousMediaItem()) p.seekTo(0) else p.seekToPreviousMediaItem()
        publish()
    }
    fun enqueue(id: String) {
        val p = player ?: return
        val song = store.state.value.songs.firstOrNull { it.id == id } ?: return
        if (p.mediaItemCount == 0) { p.addMediaItem(song.item(store, true)); p.prepare(); return }
        val flags = (0 until p.mediaItemCount).map { p.getMediaItemAt(it).mediaMetadata.extras?.getBoolean("manual") == true }
        p.addMediaItem(manualInsertionIndex(p.currentMediaItemIndex, flags), song.item(store, true)); publish()
    }
    fun shuffle() {
        val p = player ?: return
        val enabled = !store.state.value.queue.shuffle
        store.saveQueue(store.state.value.queue.copy(shuffle = enabled))
        val first = (p.currentMediaItemIndex + 1).coerceAtLeast(0)
        val pending = (first until p.mediaItemCount).map { p.getMediaItemAt(it) }
        val manual = pending.filter { it.mediaMetadata.extras?.getBoolean("manual") == true }
        val automatic = pending.filter { it.mediaMetadata.extras?.getBoolean("manual") != true }
        val order = if (enabled) automatic.shuffled() else {
            val positions = orderedSongs(store.state.value.songs, store.state.value.appearance.newest).mapIndexed { i, s -> s.id to i }.toMap()
            automatic.sortedBy { positions[it.mediaId] ?: Int.MAX_VALUE }
        }
        if (pending.isNotEmpty()) { p.removeMediaItems(first, p.mediaItemCount); p.addMediaItems(manual + order) }
        publish()
    }
    fun repeat() { player?.let { it.repeatMode = when (it.repeatMode) { Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL; Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE; else -> Player.REPEAT_MODE_OFF } }; publish() }
    fun volume(value: Float) { player?.volume = value.coerceIn(0f, 1f); store.appearance { it.copy(volume = value.coerceIn(0f, 1f)) } }
    fun remove(ids: Set<String>) {
        val p = player ?: return
        for (i in (0 until p.mediaItemCount).reversed()) if (p.getMediaItemAt(i).mediaId in ids) p.removeMediaItem(i)
        store.removeSongs(ids); publish()
    }
    fun release() { handler.removeCallbacksAndMessages(null); MediaController.releaseFuture(future); player = null }
}
