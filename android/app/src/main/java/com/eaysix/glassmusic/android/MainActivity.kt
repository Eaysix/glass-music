package com.eaysix.glassmusic.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

class MainActivity : ComponentActivity() {
    internal lateinit var playback: PlaybackClient
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val store = LibraryStore.get(this)
        playback = PlaybackClient(this, store)
        setContent { GlassApp(store, playback) }
    }
    override fun onStart() { super.onStart(); if (::playback.isInitialized) playback.visible(true) }
    override fun onStop() { if (::playback.isInitialized) playback.visible(false); super.onStop() }
    override fun onDestroy() { if (::playback.isInitialized) playback.release(); super.onDestroy() }
}
