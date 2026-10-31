package com.eaysix.glassmusic.android

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@Composable internal fun SyncScreen(store: LibraryStore) {
    val state by store.state.collectAsStateWithLifecycle()
    val busy by store.syncManager.busy.collectAsStateWithLifecycle()
    val detail by store.syncManager.detail.collectAsStateWithLifecycle()
    var code by rememberSaveable { mutableStateOf("") }
    val sync = syncObject(state)
    val link = sync.optJSONObject("link")
    Column(Modifier.fillMaxWidth().glass().padding(18.dp), verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Text("Windows ↔ Android", fontSize=20.sp)
        Text("En Windows abre Ajustes → Sincronizar, genera un código y pégalo aquí. Ambos equipos deben estar en la misma red Wi-Fi.", fontSize=12.sp)
        if(link==null) {
            OutlinedTextField(code,{code=it.take(8192)},Modifier.fillMaxWidth(),label={Text("Código de vinculación")},maxLines=3)
            Button(onClick={store.syncManager.pair(code);code=""},enabled=!busy && code.isNotBlank()) {Text("Vincular PC")}
        } else {
            Button(onClick={store.syncManager.sync()},enabled=!busy) {Text("Sincronizar datos")}
            OutlinedButton(onClick={store.syncManager.sync(state.songs.filter{it.remoteServer!=null}.map{it.id})},enabled=!busy) {Text("Descargar biblioteca de la PC")}
            TextButton(onClick={store.syncManager.unlink()},enabled=!busy) {Text("Desvincular conservando descargas")}
        }
        Text(detail,fontSize=12.sp)
        if(busy) TextButton(onClick={store.syncManager.cancel()}) {Text("Detener transferencia")}
        val conflicts=sync.optJSONArray("conflicts")?.objects().orEmpty()
        conflicts.forEachIndexed { index, conflict ->
            val sent=conflict.getJSONObject("sent")
            Text("Conflicto: ${sent.optString("name",sent.optString("id"))}",fontSize=12.sp)
            Row { TextButton(onClick={store.resolveConflict(index,true)},enabled=!busy) {Text("Conservar Android")};TextButton(onClick={store.resolveConflict(index,false)},enabled=!busy) {Text("Usar PC")} }
        }
        val source="phone:"+sync.optString("sourceId")
        val local=sync.optJSONArray("listening")?.objects().orEmpty()
        val remote=sync.optJSONArray("remoteListening")?.objects().orEmpty().filter{it.optString("source")!=source}
        val total=(local+remote).sumOf{it.optDouble("seconds",0.0)}
        Text("${(total/60).toInt()} minutos en tus dispositivos · Se actualizan al sincronizar",fontSize=12.sp)
        val resume=sync.optJSONArray("resumes")?.objects()?.firstOrNull{it.optString("deviceId")=="pc"}
        if(resume!=null) {
            val song=state.songs.firstOrNull{it.id==resume.optString("trackId")}
            Text("En tu PC: ${song?.title ?: "Canción"} · ${clock((resume.optDouble("position")*1000).toLong())}",fontSize=12.sp)
        }
    }
}
