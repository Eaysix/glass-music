package com.eaysix.glassmusic.android

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.security.cert.X509Certificate
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.*

internal fun sha(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it.toInt() and 255) }
internal fun JSONArray.objects() = (0 until length()).map { getJSONObject(it) }
internal fun JSONArray.strings() = (0 until length()).map { getString(it) }
internal fun JSONObject.optional(key: String): String? = if (isNull(key)) null else optString(key).takeIf { it.isNotEmpty() }
internal fun privateHost(host: String): Boolean {
    val parts = host.split('.')
    if (parts.size != 4 || parts.any { it != "0" && it.startsWith('0') }) return false
    val p = parts.map { it.toIntOrNull()?.takeIf { n -> n in 0..255 } ?: return false }
    return p[0] == 10 || p[0] == 192 && p[1] == 168 || p[0] == 172 && p[1] in 16..31 || p[0] == 169 && p[1] == 254
}
internal fun pairing(raw: String, now: Long = System.currentTimeMillis()): JSONObject {
    require(raw.length < 8192) { "El código es demasiado largo." }
    val text = if (raw.startsWith("glassmusic://pair")) {
        val uri = Uri.parse(raw); require(uri.scheme == "glassmusic" && uri.host == "pair")
        String(Base64.decode(requireNotNull(uri.getQueryParameter("data")), Base64.DEFAULT), Charsets.UTF_8)
    } else raw
    val j = JSONObject(text)
    require(j.getInt("protocolVersion") == 1 && privateHost(j.getString("host")) && j.getInt("port") in 1..65535 && j.getDouble("expiresAt") > now &&
        Regex("[a-fA-F0-9]{64}").matches(j.getString("fingerprint")) && Regex("[a-fA-F0-9]{64}").matches(j.getString("secret"))) { "El código expiró o no es de una PC en tu red local." }
    return j
}
// Pairing bearer tokens are encrypted using a non-exportable Android Keystore key.
internal class LinkVault(context: Context) {
    private val preferences = context.getSharedPreferences("glass-pairing", Context.MODE_PRIVATE)
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        return (store.getKey("glass-lan", null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder("glass-lan", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); generateKey()
        }
    }
    fun save(token: String) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
        val payload = cipher.iv + cipher.doFinal(token.toByteArray())
        check(preferences.edit().putString("token", Base64.encodeToString(payload, Base64.NO_WRAP)).commit())
    }
    fun read(): String {
        val data = Base64.decode(requireNotNull(preferences.getString("token", null)) { "Vuelve a vincular la PC." }, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data.copyOfRange(0,12)))
        return String(cipher.doFinal(data.copyOfRange(12,data.size)), Charsets.UTF_8)
    }
    fun clear() { preferences.edit().clear().apply() }
}
internal class LanClient(private val context: Context, private val link: JSONObject, private val token: String?, private val testLoopback: Boolean = false) {
    private val host = link.getString("host")
    private val port = link.getInt("port")
    private val fingerprint = link.getString("fingerprint").lowercase()
    private val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf<TrustManager>(object : X509TrustManager {
        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
        override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) { throw java.security.cert.CertificateException("Client certificate unsupported") }
        override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
            if (chain.isEmpty() || sha(chain[0].encoded) != fingerprint) throw java.security.cert.CertificateException("La identidad de la PC no coincide con la vinculación.")
        }
    }), null) }
    private fun connection(path: String, body: JSONObject? = null): HttpsURLConnection {
        require(privateHost(host) || testLoopback && host == "127.0.0.1")
        require(port in 1..65535 && Regex("[a-f0-9]{64}").matches(fingerprint))
        require(Regex("[a-z0-9/-]+").matches(path))
        val manager = context.getSystemService(ConnectivityManager::class.java)
        val network = requireNotNull(manager.activeNetwork) { "Conecta Android y Windows a la misma red Wi-Fi." }
        val capabilities = requireNotNull(manager.getNetworkCapabilities(network))
        require(capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) { "La sincronización necesita Wi-Fi o Ethernet; no usa datos móviles." }
        return (network.openConnection(URL("https://$host:$port/v1/$path")) as HttpsURLConnection).apply {
            sslSocketFactory = tls.socketFactory
            hostnameVerifier = HostnameVerifier { name, session -> name == host && runCatching { sha(session.peerCertificates[0].encoded) == fingerprint }.getOrDefault(false) }
            instanceFollowRedirects = false; connectTimeout = 25000; readTimeout = 60000
            if (token != null) setRequestProperty("Authorization", "Bearer $token")
            if (body != null) { requestMethod = "POST"; doOutput = true; setRequestProperty("Content-Type", "application/json"); outputStream.use { it.write(body.toString().toByteArray()) } }
        }
    }
    private fun verify(c: HttpsURLConnection) { check(c.responseCode in 200..299) { "La PC rechazó la solicitud (${c.responseCode}). Comprueba la vinculación y vuelve a intentar." } }
    fun json(path: String, body: JSONObject? = null): String {
        val c = connection(path, body)
        try { verify(c); return c.inputStream.use { input -> val bytes = input.readBytesBounded(12 * 1024 * 1024); String(bytes, Charsets.UTF_8) } } finally { c.disconnect() }
    }
    fun download(song: Song, destination: File): Long {
        val c = connection("file/${song.id}")
        c.setRequestProperty("If-Match", "\"${song.remoteRevision}\"")
        try { verify(c); c.inputStream.use { input -> destination.outputStream().use { input.copyTo(it, 64 * 1024) } }; return destination.length() } finally { c.disconnect() }
    }
    fun image(id: String): ByteArray {
        val c = connection("cover/$id")
        try { verify(c); return c.inputStream.use { it.readBytesBounded(2 * 1024 * 1024) } } finally { c.disconnect() }
    }
}
internal fun java.io.InputStream.readBytesBounded(max: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream(); val buffer = ByteArray(8192)
    while (true) { val count = read(buffer); if (count < 0) break; require(output.size() + count <= max) { "La respuesta supera el límite permitido." }; output.write(buffer,0,count) }
    return output.toByteArray()
}
internal fun syncObject(state: LibraryState) = JSONObject(state.sync)
internal fun changeKey(j: JSONObject) = j.optString("kind") + ":" + j.optString("id")
internal fun pending(state: LibraryState, value: JSONObject): LibraryState {
    val sync = syncObject(state)
    val list = sync.optJSONArray("pending")?.objects().orEmpty().filterNot { changeKey(it) == changeKey(value) }
    value.put("operationId", UUID.randomUUID().toString())
    sync.put("pending", JSONArray(list + value))
    return state.copy(sync = sync.toString())
}
internal class PcSync(private val context: Context, private val store: LibraryStore) {
    val busy = MutableStateFlow(false)
    val detail = MutableStateFlow("Vincula tu PC para sincronizar por Wi-Fi")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var task: Job? = null
    private val vault = LinkVault(context)
    fun pair(raw: String) = begin {
        val code = pairing(raw)
        val old = syncObject(store.state.value).optJSONObject("link")
        require(old == null || old.getString("serverId") == code.getString("serverId")) { "Desvincula primero la PC anterior. Las descargas se conservan." }
        val response = JSONObject(LanClient(context, code, null).json("pair", JSONObject().put("secret",code.getString("secret")).put("deviceName", "Glass Music Android")))
        require(response.getString("serverId") == code.getString("serverId"))
        vault.save(response.getString("token"))
        code.remove("secret"); code.remove("expiresAt"); code.put("deviceId", response.getString("deviceId"))
        store.mutate { current -> val s = syncObject(current); s.put("link",code); current.copy(sync=s.toString()) }
        store.state.value.playlists.forEach { store.queuePlaylist(it.id) }
        detail.value = "PC vinculada. Pulsa Sincronizar."
    }
    fun unlink() {
        if (busy.value) return
        vault.clear()
        store.mutate { current -> val s = syncObject(current); s.remove("link"); current.copy(sync=s.toString()) }
        detail.value = "PC desvinculada; tus descargas se conservan."
    }
    fun cancel() { task?.cancel() }
    private fun begin(block: suspend () -> Unit) {
        if (!busy.compareAndSet(false,true)) return
        task = scope.launch {
            try { store.awaitReady(); block() }
            catch (e: CancellationException) { detail.value = "Transferencia detenida. Puedes volver a intentar." }
            catch (e: Exception) { detail.value = e.message ?: "No se pudo sincronizar. Comprueba que ambos equipos estén en la misma red." }
            finally { busy.value = false }
        }
    }
    fun sync(download: List<String> = emptyList()) = begin {
        val link = requireNotNull(syncObject(store.state.value).optJSONObject("link")) { "Vincula primero la PC." }
        val client = LanClient(context, link, vault.read())
        exchange(client, link, download)
    }
    internal suspend fun exchange(client: LanClient, link: JSONObject, download: List<String>) {
        detail.value = "Enviando cambios…"
        val initial = JSONObject(client.json("manifest"))
        require(initial.getInt("protocolVersion") == 1 && initial.getString("serverId") == link.getString("serverId"))
        val capabilities = initial.optJSONArray("capabilities")?.strings().orEmpty()
        require("shared-playlists-v1" in capabilities && "shared-listening-v1" in capabilities) { "Actualiza Glass Music en Windows para sincronizar playlists y minutos." }
        val outgoing = syncObject(store.state.value).optJSONArray("pending")?.objects().orEmpty()
        for (operation in outgoing) {
            currentCoroutineContext().ensureActive()
            val payload = JSONObject(operation.toString()).apply { remove("operationId") }
            val result = JSONArray(client.json("changes", JSONObject().put("changes",JSONArray().put(payload)))).getJSONObject(0)
            if (result.optBoolean("applied")) {
                val snapshot = JSONObject(client.json("manifest"))
                store.acknowledge(operation, snapshot)
            } else store.syncConflict(operation, result)
        }
        val snapshot = syncObject(store.state.value)
        val source = snapshot.optString("sourceId")
        snapshot.optJSONArray("listening")?.objects().orEmpty().chunked(250).forEach { entries ->
            currentCoroutineContext().ensureActive()
            val result = JSONArray(client.json("changes",JSONObject().put("changes",JSONArray().put(JSONObject().put("kind","listening").put("sourceId",source).put("entries",JSONArray(entries)))))).getJSONObject(0)
            check(result.optBoolean("applied")) { "Los minutos no pudieron sincronizarse; se conservan para reintentar." }
        }
        val q = store.state.value.queue
        val current = store.state.value.songs.firstOrNull { it.id == q.ids.getOrNull(q.index) && it.remoteServer == link.getString("serverId") }
        if (current != null) client.json("changes",JSONObject().put("changes",JSONArray().put(JSONObject().put("kind","resume").put("trackId",current.id).put("position",q.position / 1000.0))))
        val manifest = JSONObject(client.json("manifest"))
        store.mergePC(manifest)
        val selected = store.state.value.songs.filter { it.remoteServer == link.getString("serverId") && (it.id in download || store.isDownloaded(it) && it.fileRevision != it.remoteRevision) }
        for ((index, song) in selected.withIndex()) {
            currentCoroutineContext().ensureActive()
            detail.value = "Descargando ${index+1}/${selected.size}: ${song.title}"
            if (!store.isDownloaded(song) || song.fileRevision != song.remoteRevision) store.installPC(song, client)
        }
        for (song in store.state.value.songs.filter { it.remoteServer == link.getString("serverId") && store.isDownloaded(it) }) {
            currentCoroutineContext().ensureActive()
            val edited = syncObject(store.state.value).optJSONArray("pending")?.objects().orEmpty().any { it.optString("kind") == "lyrics" && it.optString("id") == song.id }
            if (!edited) store.cachePCLyrics(song.id, JSONObject(client.json("lyrics/${song.id}")))
        }
        val count = syncObject(store.state.value).optJSONArray("conflicts")?.length() ?: 0
        detail.value = if (count == 0) "Todo al día. Tus descargas funcionan sin conexión." else "Sincronizado con $count conflictos. Elige qué versión conservar."
    }
}
