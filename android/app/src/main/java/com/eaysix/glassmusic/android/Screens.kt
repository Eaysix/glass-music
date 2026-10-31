package com.eaysix.glassmusic.android

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.util.Locale
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import kotlinx.coroutines.CancellationException

@Composable internal fun LibraryScreen(title: String, songs: List<Song>, newest: Boolean, store: LibraryStore,
    modifier: Modifier, back: (() -> Unit)?, onImport: () -> Unit, importing: Boolean,
    play: (Song, List<String>) -> Unit, enqueue: (String) -> Unit, favorite: (String) -> Unit,
    add: (String) -> Unit, remove: (String) -> Unit, sort: () -> Unit) {
    val scope=rememberCoroutineScope()
    var batchJob by remember { mutableStateOf<Job?>(null) }
    var confirmBatch by remember { mutableStateOf(false) }
    var batchStatus by remember { mutableStateOf("") }
    var query by rememberSaveable(title) { mutableStateOf("") }
    val visible = remember(songs, query, newest) { orderedSongs(songs, newest).filter { "${it.title} ${it.artist} ${it.album}".contains(query, true) } }
    if(confirmBatch) AlertDialog(onDismissRequest={confirmBatch=false},title={Text("Buscar letras faltantes")},text={Text("Envía título y artista de esta lista a LRCLIB. No envía audio ni reemplaza letras guardadas. Las coincidencias dudosas se revisan manualmente.")},confirmButton={TextButton(onClick={
        confirmBatch=false
        batchJob=scope.launch {
            var saved=0;var skipped=0
            try {
                for(song in visible) {
                    val before=store.state.value.songs.firstOrNull{it.id==song.id} ?: continue
                    if(before.lyrics.isNotBlank())continue
                    val match=LyricsSearch.search(song).firstOrNull {
                        it.optString("trackName").trim().equals(song.title.trim(),true) && it.optString("artistName").trim().equals(song.artist.trim(),true) && kotlin.math.abs(it.optDouble("duration")-song.durationMs/1000.0)<=2
                    }
                    if(match!=null && store.state.value.songs.firstOrNull{it.id==song.id}?.lyrics?.isBlank()==true){store.lyrics(song.id,lyricsText(match));saved++}else skipped++
                    batchStatus="$saved guardadas · $skipped por revisar";delay(900)
                }
                batchStatus="Listo: $saved guardadas · $skipped por revisar"
            }catch(e:CancellationException){batchStatus="Búsqueda detenida. Letras guardadas: $saved";throw e}
            catch(e:Exception){batchStatus=e.message ?: "No se pudo buscar."}
            finally{batchJob=null}
        }
    }){Text("Buscar en LRCLIB")}},dismissButton={TextButton(onClick={confirmBatch=false}){Text("Cancelar")}})
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (back != null) IconButton(onClick = back) { Icon(Icons.Default.ArrowBack, "Volver") }
                Text(title, fontSize = 29.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 2)
                IconButton(onClick = onImport, enabled = !importing, modifier = Modifier.testTag("import-collection")) { Icon(Icons.Default.Add, "Importar archivos a esta lista") }
            }
        }
        item { OutlinedTextField(query, { query = it }, Modifier.fillMaxWidth(), label = { Text("Canción, artista o álbum") }, singleLine = true, leadingIcon = { Icon(Icons.Default.Search, null) }) }
        item { Row(verticalAlignment = Alignment.CenterVertically) { Text("${visible.size} canciones", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f)); TextButton(onClick = sort) { Text(if (newest) "Nuevas primero" else "Antiguas primero", fontSize = 12.sp) } } }
        if(visible.isNotEmpty()) item { Column {
            TextButton(onClick={if(batchJob!=null)batchJob?.cancel()else confirmBatch=true}){Text(if(batchJob==null)"Buscar letras faltantes"else"Detener búsqueda de letras")}
            if(batchStatus.isNotBlank())Text(batchStatus,fontSize=11.sp)
        } }
        if (back != null && visible.isNotEmpty()) item {
            Row { Button(onClick = { visible.filter(store::isDownloaded).randomOrNull()?.let { play(it,visible.map { s -> s.id }) } }) { Text("Reproducir") }
                TextButton(onClick = { store.syncManager.sync(visible.map { it.id }) }) { Text("Descargar playlist") } }
        }
        if (visible.isEmpty()) item { Column(Modifier.fillMaxWidth().glass().padding(24.dp)) { Text(if (query.isBlank()) "Tu música empieza aquí" else "Sin resultados", fontWeight = FontWeight.Bold); Text("Importa archivos FLAC o MP3 desde el botón +.", Modifier.padding(top = 8.dp), color = Color.White.copy(alpha = .6f)) } }
        items(visible, key = { it.id }) { song ->
            var menu by remember { mutableStateOf(false) }
            Row(Modifier.fillMaxWidth().glass(18).clickable { if(store.isDownloaded(song))play(song, visible.map { it.id })else store.message.value="Descarga esta canción desde sus opciones para escucharla sin conexión." }.padding(start = 10.dp, top = 8.dp, bottom = 8.dp).testTag("play-${song.id}"), verticalAlignment = Alignment.CenterVertically) {
                Cover(song, store, Modifier.size(46.dp))
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(song.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold)
                    Text(song.artist, maxLines = 1, style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = .55f))
                }
                IconButton(onClick = { favorite(song.id) }) { Icon(Icons.Default.Favorite, if (song.favorite) "Quitar de favoritas" else "Me gusta", tint = if (song.favorite) MaterialTheme.colorScheme.primary else Color.White.copy(alpha = .25f)) }
                Box {
                    IconButton(onClick = { menu = true }, modifier = Modifier.testTag("song-menu-${song.id}")) { Icon(Icons.Default.MoreVert, "Opciones de canción") }
                    DropdownMenu(menu, { menu = false }) {
                        if(song.remoteServer!=null) DropdownMenuItem(text = { Text("Descargar para escuchar sin conexión") }, onClick = { menu=false;store.syncManager.sync(listOf(song.id)) })
                        DropdownMenuItem(text = { Text("Añadir a la cola") }, onClick = { menu = false; enqueue(song.id) })
                        DropdownMenuItem(text = { Text("Agregar a playlist") }, onClick = { menu = false; add(song.id) })
                        DropdownMenuItem(text = { Text("Quitar de la app") }, onClick = { menu = false; remove(song.id) })
                    }
                }
            }
        }
    }
}

@Composable internal fun SettingsScreen(appearance: Appearance, store: LibraryStore, client: PlaybackClient, modifier: Modifier) {
    LazyColumn(modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
        item { SyncScreen(store, client) }
        item { Text("A tu manera.", fontSize = 34.sp, fontWeight = FontWeight.Bold) }
        item { OutlinedTextField(appearance.name, { text -> store.appearance { it.copy(name = text.take(60)) } }, Modifier.fillMaxWidth(), label = { Text("Nombre de tu espacio") }, singleLine = true) }
        item { Column(Modifier.glass().padding(20.dp)) {
            Text("Color principal", fontWeight = FontWeight.Bold)
            Row(Modifier.padding(top = 18.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                listOf(0xFF8CCDF3, 0xFFBDA9FA, 0xFF89D9BE, 0xFFF0B7CD, 0xFFE9C58A).forEach { color ->
                    Box(Modifier.size(42.dp).background(Color(color), CircleShape).border(if (appearance.accent == color) 3.dp else 0.dp, Color.White, CircleShape).clickable { store.appearance { it.copy(accent = color) } })
                }
            }
        } }
        item { Row(Modifier.fillMaxWidth().glass().padding(20.dp), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text("Aurora en movimiento", fontWeight = FontWeight.Bold); Text("Animación suave del fondo", fontSize = 12.sp, color = Color.White.copy(alpha = .55f)) }; Switch(appearance.animated, { value -> store.appearance { it.copy(animated = value) } }) } }
        item { Column(Modifier.glass().padding(20.dp)) {
            Text("Tamaño de la interfaz", fontWeight = FontWeight.Bold)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                listOf(.85f to "Pequeño", 1f to "Normal", 1.2f to "Grande").forEach { (scale, title) -> TextButton(onClick = { store.appearance { it.copy(scale = scale) } }) { Text(title, color = if (appearance.scale == scale) MaterialTheme.colorScheme.primary else Color.White.copy(alpha = .5f)) } }
            }
        } }
        item { Column(Modifier.glass().padding(20.dp)) { Text("Volumen de Glass Music", fontWeight = FontWeight.Bold); Slider(appearance.volume, client::volume, modifier = Modifier.fillMaxWidth()); Text("${(appearance.volume * 100).toInt()} %", color = Color.White.copy(alpha = .55f)) } }
        item { Text("Glass Music ${BuildConfig.VERSION_NAME}\nPrimera versión para Android · Reproducción local\nLa sincronización con PC estará disponible en una próxima versión.", color = Color.White.copy(alpha = .5f), style = MaterialTheme.typography.bodySmall) }
    }
}

@Composable internal fun FullPlayer(song: Song, media: TransportState, shuffle: Boolean, animated: Boolean, store: LibraryStore,
    dismiss: () -> Unit, client: PlaybackClient, queue: () -> Unit, editLyrics: () -> Unit) {
    var lyrics by rememberSaveable { mutableStateOf(false) }
    var scrubbing by remember(song.id) { mutableStateOf<Float?>(null) }
    val progress = if (media.duration > 0) (media.position.toDouble() / media.duration).toFloat().coerceIn(0f, 1f) else 0f
    val tint = MaterialTheme.colorScheme.primary
    Dialog(dismiss, DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        Box(Modifier.fillMaxSize().background(Color(0xFF101622))) {
            GlassBackground(tint, animated)
            Column(Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    IconButton(onClick = dismiss) { Icon(Icons.Default.ArrowBack, "Cerrar reproductor") }
                    Text("GLASS MUSIC", letterSpacing = 2.sp, fontSize = 11.sp, color = tint, modifier = Modifier.weight(1f))
                    TextButton(onClick = { lyrics = !lyrics }) { Text(if (lyrics) "Portada" else "Letra") }
                    IconButton(onClick = queue) { Icon(Icons.Default.Menu, "Cola") }
                }
                if (lyrics) LyricsPanel(song.lyrics, media.position, animated, client::seek)
                else AnimatedContent(song.id, label = "portada") { id ->
                    Cover(song.takeIf { it.id == id }, store, Modifier.widthIn(max = 400.dp).fillMaxWidth().aspectRatio(1f).glass(30).padding(7.dp))
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text(song.title, fontSize = 28.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, maxLines = 2); Text(song.artist, Modifier.padding(top = 8.dp), color = Color.White.copy(alpha = .55f), maxLines = 2) }
                    IconButton(onClick = { store.favorite(song.id) }) { Icon(Icons.Default.Favorite, "Me gusta", tint = if (song.favorite) tint else Color.White.copy(alpha = .4f)) }
                }
                Column {
                    Slider(scrubbing ?: progress, { scrubbing = it }, Modifier.fillMaxWidth().testTag("timeline"), enabled = media.duration > 0,
                        onValueChangeFinished = { if (client.state.value.id == song.id) client.seek(((scrubbing ?: progress) * media.duration).toLong()); scrubbing = null })
                    Row(Modifier.fillMaxWidth()) { Text(clock(scrubbing?.let { (it * media.duration).toLong() } ?: media.position), Modifier.testTag("elapsed"), color = Color.White.copy(alpha = .55f)); Spacer(Modifier.weight(1f)); Text(clock(media.duration), Modifier.testTag("duration"), color = Color.White.copy(alpha = .55f)) }
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceEvenly) {
                    TextButton(onClick = client::shuffle, modifier = Modifier.width(56.dp), contentPadding = PaddingValues(0.dp)) { Text("Mezcla", fontSize = 10.sp, color = if (shuffle) tint else Color.White.copy(alpha = .4f)) }
                    TransportIcon("previous", "Anterior", client::previous)
                    TransportIcon(if (media.playing) "pause" else "play", if (media.playing) "Pausar" else "Reproducir", client::toggle, large = true)
                    TransportIcon("next", "Siguiente", client::next)
                    TextButton(onClick = client::repeat, modifier = Modifier.width(56.dp), contentPadding = PaddingValues(0.dp)) { Text(when (media.repeat) { 1 -> "Una"; 2 -> "Lista"; else -> "Repetir" }, fontSize = 10.sp, color = if (media.repeat != 0) tint else Color.White.copy(alpha = .4f)) }
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text("${song.format} · En este teléfono", Modifier.weight(1f), fontSize = 12.sp, color = Color.White.copy(alpha = .5f)); TextButton(onClick = editLyrics) { Text("Editar letra", fontSize = 12.sp) } }
                Spacer(Modifier.height(12.dp))
            }
        }
    }
}

@Composable private fun LyricsPanel(raw: String, position: Long, animated: Boolean, seek: (Long) -> Unit) {
    val lines = remember(raw) { parseLyrics(raw) }
    val active = lines.indexOfLast { it.timeMs <= position }
    val list = rememberLazyListState()
    LaunchedEffect(active) { if (active >= 0) { if (animated) list.animateScrollToItem((active - 1).coerceAtLeast(0)) else list.scrollToItem((active - 1).coerceAtLeast(0)) } }
    LazyColumn(Modifier.fillMaxWidth().height(330.dp).glass().padding(20.dp), state = list, verticalArrangement = Arrangement.spacedBy(26.dp)) {
        if (lines.isEmpty()) item { Text(raw.ifBlank { "Esta canción todavía no tiene letra. Puedes escribirla desde Editar letra." }, fontSize = 24.sp, color = Color.White.copy(alpha = .6f)) }
        else itemsIndexed(lines) { i, line -> Text(line.text.ifBlank { "♪" }, Modifier.fillMaxWidth().clickable { seek(line.timeMs) }, fontSize = 25.sp, lineHeight = 32.sp, fontWeight = FontWeight.Bold, color = if (i == active) MaterialTheme.colorScheme.primary else Color.White.copy(alpha = .35f)) }
    }
}

@Composable internal fun PlaylistDialog(playlist: Playlist?, songs: List<Song>, imported: List<String>, store: LibraryStore, importing: Boolean,
    onImport: () -> Unit, dismiss: () -> Unit, save: (String, List<String>) -> Unit) {
    var name by remember(playlist?.id) { mutableStateOf(playlist?.name ?: "") }
    var selected by remember(playlist?.id) { mutableStateOf(playlist?.ids?.toSet() ?: emptySet()) }
    LaunchedEffect(imported) { selected = selected + imported }
    AlertDialog(onDismissRequest = dismiss, title = { Text(if (playlist == null) "Crea tu playlist" else "Edita tu playlist") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(name, { name = it.take(100) }, label = { Text("Nombre de la playlist") }, singleLine = true, modifier = Modifier.testTag("playlist-name"))
            TextButton(onClick = onImport, enabled = !importing, modifier = Modifier.testTag("import-playlist")) { Icon(Icons.Default.Add, null); Text(if (importing) "Importando…" else "Importar archivos a esta playlist", fontSize = 12.sp) }
            Text("${selected.size} seleccionadas", color = MaterialTheme.colorScheme.primary)
            LazyColumn(Modifier.heightIn(max = 250.dp)) { items(songs, key = { it.id }) { song ->
                Row(Modifier.fillMaxWidth().clickable { selected = if (song.id in selected) selected - song.id else selected + song.id }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(song.id in selected, { checked -> selected = if (checked) selected + song.id else selected - song.id })
                    Text(song.title, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 13.sp)
                }
            } }
        }
    }, confirmButton = { TextButton(onClick = { save(name, selected.toList()) }, enabled = name.isNotBlank() && !importing, modifier = Modifier.testTag("save-playlist")) { Text("Guardar") } }, dismissButton = { TextButton(onClick = dismiss) { Text("Cancelar") } })
}

@Composable internal fun LyricsEditor(song: Song, position: Long, dismiss: () -> Unit, save: (String) -> Unit) {
    var text by remember(song.id) { mutableStateOf(TextFieldValue(song.lyrics)) }
    val scope=rememberCoroutineScope()
    var searching by remember { mutableStateOf(false) }
    var candidates by remember { mutableStateOf<List<org.json.JSONObject>>(emptyList()) }
    var notice by remember { mutableStateOf("") }
    var chosen by remember { mutableStateOf<org.json.JSONObject?>(null) }
    AlertDialog(onDismissRequest = dismiss, title = { Text("Letra · ${song.title}", maxLines = 2) }, text = {
        Column(Modifier.heightIn(max=520.dp).verticalScroll(rememberScrollState())) {
            TextButton(enabled=!searching,onClick={scope.launch {
                searching=true;notice="";try{candidates=LyricsSearch.search(song);if(candidates.isEmpty())notice="Sin coincidencias. Puedes escribirla manualmente."}catch(e:Exception){notice=e.message ?: "No se pudo buscar."}finally{searching=false}
            }}) {Text(if(searching)"Buscando…"else"Buscar letra en LRCLIB")}
            Text("Envía título y artista; el audio se queda en tu teléfono.",fontSize=11.sp)
            if(notice.isNotEmpty())Text(notice,fontSize=11.sp)
            if(candidates.isNotEmpty()) LazyColumn(Modifier.heightIn(max=120.dp)) { items(candidates) { result ->
                TextButton(onClick={chosen=result}) {Text("${result.optString("trackName")} · ${result.optString("artistName")} · ${result.optDouble("duration").toInt()} s · ${if(result.optional("syncedLyrics")!=null)"Sincronizada"else"Texto"}",fontSize=11.sp)}
            } }
            if(chosen!=null) { Text(lyricsText(chosen!!).take(180),fontSize=11.sp);TextButton(onClick={text=TextFieldValue(lyricsText(chosen!!));chosen=null;candidates=emptyList()}){Text("Usar en el borrador")} }
            Text("Texto libre o LRC. Coloca el cursor antes de una línea para marcarla con el tiempo actual.", fontSize = 12.sp, color = Color.White.copy(alpha = .55f))
            OutlinedTextField(text, { text = it }, Modifier.fillMaxWidth().heightIn(min = 180.dp, max = 300.dp).testTag("lyrics-text"), label = { Text("Letra y tiempos LRC") })
            TextButton(onClick = {
                val stamp = "[%02d:%05.2f]".format(Locale.ROOT, position / 60_000, (position % 60_000) / 1000.0)
                val at = text.selection.start.coerceIn(0, text.text.length)
                text = TextFieldValue(text.text.substring(0, at) + stamp + text.text.substring(at), TextRange(at + stamp.length))
            }) { Text("Marcar ${clock(position)}") }
        }
    }, confirmButton = { TextButton(onClick = { save(text.text) }, enabled = text.text.toByteArray().size <= 1024 * 1024) { Text("Guardar letra") } }, dismissButton = { TextButton(onClick = dismiss) { Text("Cancelar") } })
}
