package com.eaysix.glassmusic.android

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private val Ink = Color(0xFF101622)
internal fun Modifier.glass(radius: Int = 24) = clip(RoundedCornerShape(radius.dp))
    .background(Color.White.copy(alpha = 0.055f)).border(1.dp, Color.White.copy(alpha = 0.12f), RoundedCornerShape(radius.dp))

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun GlassApp(store: LibraryStore, client: PlaybackClient) {
    val library by store.state.collectAsStateWithLifecycle()
    val media by client.state.collectAsStateWithLifecycle()
    val message by store.message.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    var playlistId by rememberSaveable { mutableStateOf<String?>(null) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    var queue by remember { mutableStateOf(false) }
    var editingList by remember { mutableStateOf<Playlist?>(null) }
    var creatingList by remember { mutableStateOf(false) }
    var addingIds by remember { mutableStateOf<List<String>?>(null) }
    var deletingList by remember { mutableStateOf<Playlist?>(null) }
    var deletingSongs by remember { mutableStateOf<Set<String>?>(null) }
    var lyricsSong by remember { mutableStateOf<Song?>(null) }
    var importing by remember { mutableStateOf(false) }
    var importTarget by remember { mutableStateOf<String?>(null) }
    var draftImports by remember { mutableStateOf<List<String>>(emptyList()) }
    var importIntoDraft by remember { mutableStateOf(false) }
    val importer = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) scope.launch {
            importing = true
            val ids = store.importFiles(uris, importTarget)
            if (importIntoDraft) draftImports = (draftImports + ids).distinct()
            importing = false
        }
    }
    fun pick(target: String?, draft: Boolean = false) {
        importTarget = target; importIntoDraft = draft
        importer.launch(arrayOf("audio/*", "application/octet-stream"))
    }
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateFlow.collectAsState()
    val current = library.songs.firstOrNull { it.id == media.id }
    val tint = Color(library.appearance.accent)
    val density = LocalDensity.current
    CompositionLocalProvider(LocalDensity provides Density(density.density, density.fontScale * library.appearance.scale)) {
        MaterialTheme(colorScheme = darkColorScheme(primary = tint, onPrimary = Ink, surface = Color(0xFF1A2435), background = Ink)) {
            Box(Modifier.fillMaxSize()) {
                GlassBackground(tint, library.appearance.animated && lifecycleState.isAtLeast(Lifecycle.State.STARTED))
                Scaffold(containerColor = Color.Transparent, bottomBar = {
                    Column {
                        if (current != null) Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp).fillMaxWidth().glass().clickable { expanded = true }.padding(10.dp).testTag("mini-player"), verticalAlignment = Alignment.CenterVertically) {
                            Cover(current, store, Modifier.size(48.dp))
                            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                Text(current.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.Bold)
                                Text(current.artist, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = .55f), maxLines = 1)
                            }
                            TransportIcon(if (media.playing) "pause" else "play", if (media.playing) "Pausar" else "Reproducir", client::toggle)
                            TransportIcon("next", "Siguiente", client::next)
                        }
                        NavigationBar(containerColor = Ink.copy(alpha = .8f)) {
                            listOf("Inicio", "Biblioteca", "Favoritas", "Ajustes").forEachIndexed { index, label ->
                                NavigationBarItem(selected = tab == index && playlistId == null, onClick = { tab = index; playlistId = null },
                                    icon = { Icon(when (index) { 0 -> Icons.Default.Home; 1 -> Icons.Default.Menu; 2 -> Icons.Default.Favorite; else -> Icons.Default.Settings }, label) }, label = { Text(label, fontSize = 10.sp) })
                            }
                        }
                    }
                }) { padding ->
                    if (!library.ready) Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                    else if (tab == 3 && playlistId == null) SettingsScreen(library.appearance, store, client, Modifier.padding(padding))
                    else if (tab == 0 && playlistId == null) {
                        LazyColumn(Modifier.padding(padding).fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                            item { Brand() }
                            item { Column { Text("Tu música.\nContigo.", fontSize = 40.sp, lineHeight = 44.sp, fontWeight = FontWeight.Bold); Spacer(Modifier.height(12.dp)); Text("${library.appearance.name} · ${library.songs.size} canciones sin conexión", color = Color.White.copy(alpha = .55f)) } }
                            if (current != null) item {
                                Row(Modifier.fillMaxWidth().glass().clickable { expanded = true }.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Cover(current, store, Modifier.size(58.dp)); Column(Modifier.weight(1f).padding(start = 16.dp)) { Text("SEGUIR ESCUCHANDO", fontSize = 10.sp, letterSpacing = 2.sp, color = tint); Text(current.title, fontWeight = FontWeight.Bold); Text(clock(media.position), color = Color.White.copy(alpha = .55f)) }
                                    TransportIcon(if (media.playing) "pause" else "play", "Reproducir o pausar", client::toggle)
                                }
                            }
                            item { Row(verticalAlignment = Alignment.CenterVertically) { Text("Tus playlists", fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); IconButton(onClick = { creatingList = true; draftImports = emptyList() }, Modifier.testTag("create-playlist")) { Icon(Icons.Default.Add, "Crear playlist") } } }
                            if (library.playlists.isEmpty()) item { Text("Crea una playlist e importa archivos directamente en ella.", color = Color.White.copy(alpha = .55f)) }
                            items(library.playlists, key = { it.id }) { list ->
                                Row(Modifier.fillMaxWidth().glass().clickable { playlistId = list.id }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Cover(library.songs.firstOrNull { it.id == list.ids.firstOrNull() }, store, Modifier.size(56.dp))
                                    Column(Modifier.weight(1f).padding(horizontal = 14.dp)) { Text(list.name, fontWeight = FontWeight.Bold); Text("${list.ids.size} canciones", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = .55f)) }
                                    ListMenu(edit = { editingList = list; creatingList = true; draftImports = emptyList() }, delete = { deletingList = list })
                                }
                            }
                            item { Button(onClick = { pick(null) }, enabled = !importing, modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp)) { Icon(Icons.Default.Add, null); Text(if (importing) "Importando…" else "Importar música", Modifier.padding(start = 8.dp)) } }
                            item { Text("Archivos FLAC y MP3 · Sin cuentas ni conexión\nAndroid ${BuildConfig.VERSION_NAME} · Primera versión local", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = .4f)) }
                        }
                    } else {
                        val list = library.playlists.firstOrNull { it.id == playlistId }
                        val songs = when { playlistId != null -> list?.ids?.mapNotNull { id -> library.songs.firstOrNull { it.id == id } } ?: emptyList(); tab == 2 -> library.songs.filter { it.favorite }; else -> library.songs }
                        LibraryScreen(list?.name ?: if (tab == 2) "Tus favoritas" else "Tu biblioteca", songs, library.appearance.newest, store,
                            Modifier.padding(padding), back = if (playlistId != null) ({ playlistId = null }) else null,
                            onImport = { pick(playlistId) }, importing = importing,
                            play = { song, ids -> client.play(song.id, ids) }, enqueue = client::enqueue,
                            favorite = store::favorite, add = { addingIds = listOf(it) }, remove = { deletingSongs = setOf(it) },
                            sort = { store.appearance { it.copy(newest = !it.newest) } })
                    }
                }
            }
            if (expanded && current != null) FullPlayer(current, media, library.queue.shuffle, library.appearance.animated, store,
                dismiss = { expanded = false }, client = client, queue = { queue = true }, editLyrics = { lyricsSong = current })
            if (queue) ModalBottomSheet(onDismissRequest = { queue = false }, containerColor = Color(0xFF182236)) {
                Text("A continuación", fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(20.dp))
                if (media.upcoming.isEmpty()) Text("La cola está vacía.", Modifier.padding(20.dp))
                LazyColumn(Modifier.heightIn(max = 500.dp)) { itemsIndexed(media.upcoming, key = { i, id -> "$i:$id" }) { i, id ->
                    val song = library.songs.firstOrNull { it.id == id }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${i + 1}", color = tint, modifier = Modifier.width(28.dp)); Text(song?.title ?: "Canción", Modifier.weight(1f), maxLines = 1)
                        IconButton(onClick = { client.player?.let { val index = it.currentMediaItemIndex + 1 + i; if (index in 0 until it.mediaItemCount) it.removeMediaItem(index) } }) { Icon(Icons.Default.Close, "Quitar de la cola") }
                    }
                } }
                Spacer(Modifier.navigationBarsPadding().height(20.dp))
            }
            if (creatingList) PlaylistDialog(editingList, library.songs, draftImports, store, importing, onImport = { pick(null, true) },
                dismiss = { creatingList = false; editingList = null }, save = { name, ids ->
                    store.savePlaylist(editingList?.id, name, ids); creatingList = false; editingList = null
                })
            if (addingIds != null) AlertDialog(onDismissRequest = { addingIds = null }, title = { Text("Agregar a playlist") }, text = {
                Column(Modifier.verticalScroll(rememberScrollState()).heightIn(max = 350.dp)) {
                    if (library.playlists.isEmpty()) Text("Crea una playlist desde Inicio.")
                    library.playlists.forEach { list -> TextButton(onClick = { store.addToPlaylist(list.id, addingIds.orEmpty()); addingIds = null }) { Text(list.name) } }
                }
            }, confirmButton = { TextButton(onClick = { addingIds = null }) { Text("Cerrar") } })
            if (deletingList != null) AlertDialog(onDismissRequest = { deletingList = null }, title = { Text("¿Eliminar esta playlist?") }, text = { Text("Las canciones y los archivos importados se conservan.") },
                confirmButton = { TextButton(onClick = { deletingList?.let { store.deletePlaylist(it.id) }; deletingList = null }) { Text("Eliminar playlist") } }, dismissButton = { TextButton(onClick = { deletingList = null }) { Text("Cancelar") } })
            if (deletingSongs != null) AlertDialog(onDismissRequest = { deletingSongs = null }, title = { Text("¿Quitar de Glass Music?") }, text = { Text("Se eliminará la copia guardada en la app y sus referencias en playlists. El archivo original se conserva.") },
                confirmButton = { TextButton(onClick = { client.remove(deletingSongs.orEmpty()); deletingSongs = null }) { Text("Eliminar copia") } }, dismissButton = { TextButton(onClick = { deletingSongs = null }) { Text("Cancelar") } })
            lyricsSong?.let { song -> LyricsEditor(song, media.position, dismiss = { lyricsSong = null }, save = { text -> store.lyrics(song.id, text); lyricsSong = null }) }
            message?.let { text -> AlertDialog(onDismissRequest = { store.message.value = null }, title = { Text("Glass Music") }, text = { Text(text) }, confirmButton = { TextButton(onClick = { store.message.value = null }) { Text("Entendido") } }) }
        }
    }
}

@Composable private fun Brand() {
    Row(verticalAlignment = Alignment.CenterVertically) { Wave(Modifier.size(24.dp), MaterialTheme.colorScheme.primary); Text("glass", fontWeight = FontWeight.Bold, fontSize = 21.sp, modifier = Modifier.padding(start = 10.dp)); Text("music", fontSize = 21.sp, color = Color.White.copy(alpha = .55f)); Spacer(Modifier.weight(1f)); Text("LOCAL PLAYER", fontSize = 9.sp, letterSpacing = 2.sp, color = Color.White.copy(alpha = .4f)) }
}

@Composable internal fun GlassBackground(tint: Color, animated: Boolean) {
    if (animated) {
        val transition = rememberInfiniteTransition(label = "aurora")
        val drift = transition.animateFloat(0f, 1f, infiniteRepeatable(tween(14000, easing = FastOutSlowInEasing), RepeatMode.Reverse), label = "drift")
        Canvas(Modifier.fillMaxSize().background(Ink)) {
            val t = drift.value
            drawRect(Brush.radialGradient(listOf(tint.copy(alpha = .25f), Color.Transparent), Offset(size.width * (.1f + t * .5f), size.height * .2f), size.width * 1.3f))
            drawRect(Brush.radialGradient(listOf(Color(0xFF9582DA).copy(alpha = .2f), Color.Transparent), Offset(size.width * (.9f - t * .3f), size.height * .85f), size.width * 1.3f))
        }
    } else Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF1D2D40), Ink))))
}

@Composable internal fun Cover(song: Song?, store: LibraryStore, modifier: Modifier = Modifier) {
    var bitmap by remember(song?.id) { mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null) }
    LaunchedEffect(song?.id) { bitmap = withContext(Dispatchers.IO) { song?.let(store::coverFile)?.let { BitmapFactory.decodeFile(it.path)?.asImageBitmap() } } }
    Box(modifier.clip(RoundedCornerShape(18.dp)).background(Brush.linearGradient(listOf(Color(0xFF365167), Color(0xFF25263F)))), contentAlignment = Alignment.Center) {
        if (bitmap != null) Image(bitmap!!, null, Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
        else Wave(Modifier.fillMaxSize().padding(14.dp), MaterialTheme.colorScheme.primary)
    }
}
@Composable private fun Wave(modifier: Modifier, color: Color) {
    Canvas(modifier) {
        listOf(.28f, .65f, 1f, .5f, .3f).forEachIndexed { index, height ->
            val x = size.width * (.14f + index * .18f)
            drawLine(color, Offset(x, size.height * (.5f - height * .35f)), Offset(x, size.height * (.5f + height * .35f)), size.width * .07f, cap = androidx.compose.ui.graphics.StrokeCap.Round)
        }
    }
}
@Composable internal fun TransportIcon(kind: String, label: String, action: () -> Unit, large: Boolean = false, active: Boolean = true) {
    val tint = if (large) Ink else if (active) MaterialTheme.colorScheme.primary else Color.White.copy(alpha = .4f)
    IconButton(onClick = action, modifier = Modifier.size(if (large) 76.dp else 48.dp).then(if (large) Modifier.background(MaterialTheme.colorScheme.primary, CircleShape) else Modifier).testTag(label)) {
        Canvas(Modifier.size(if (large) 30.dp else 23.dp).semantics { contentDescription = label }) {
            val w = size.width; val h = size.height
            fun triangle(left: Float, right: Float, reverse: Boolean = false) { val p = Path().apply { moveTo(if (reverse) right else left, h * .12f); lineTo(if (reverse) left else right, h * .5f); lineTo(if (reverse) right else left, h * .88f); close() }; drawPath(p, tint) }
            if (kind == "pause") { drawRect(tint, Offset(w * .2f, h * .12f), androidx.compose.ui.geometry.Size(w * .2f, h * .76f)); drawRect(tint, Offset(w * .6f, h * .12f), androidx.compose.ui.geometry.Size(w * .2f, h * .76f)) }
            else if (kind == "previous") { triangle(w * .23f, w * .85f, true); drawLine(tint, Offset(w * .12f, h * .12f), Offset(w * .12f, h * .88f), w * .12f) }
            else { triangle(w * .18f, if (kind == "next") w * .76f else w * .88f); if (kind == "next") drawLine(tint, Offset(w * .88f, h * .12f), Offset(w * .88f, h * .88f), w * .12f) }
        }
    }
}

@Composable private fun ListMenu(edit: () -> Unit, delete: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box { IconButton(onClick = { open = true }) { Icon(Icons.Default.MoreVert, "Opciones de playlist") }; DropdownMenu(open, { open = false }) {
        DropdownMenuItem(text = { Text("Editar playlist") }, onClick = { open = false; edit() }); DropdownMenuItem(text = { Text("Eliminar playlist") }, onClick = { open = false; delete() })
    } }
}
