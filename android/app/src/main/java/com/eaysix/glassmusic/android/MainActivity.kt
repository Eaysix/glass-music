package com.eaysix.glassmusic.android

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle

class MainActivity : ComponentActivity() {
    internal lateinit var playback: PlaybackClient
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        val store = LibraryStore.get(this)
        playback = PlaybackClient(this, store)
        setContent { GlassApp(store, playback) }
    }
    override fun onStart() { super.onStart(); if (::playback.isInitialized) playback.visible(true) }
    override fun onStop() { if (::playback.isInitialized) playback.visible(false); super.onStop() }
    override fun onDestroy() { if (::playback.isInitialized) playback.release(); super.onDestroy() }
}
