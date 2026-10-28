import Foundation
import UIKit

@MainActor final class SyncManager: ObservableObject {
    @Published private(set) var busy = false
    @Published private(set) var detail = "Lista para conectar con tu PC"
    @Published private(set) var progress: Double = 0
    private let library: Library
    private let player: MusicPlayer
    private var work: Task<Void, Never>?
    init(library: Library, player: MusicPlayer) { self.library = library; self.player = player }
    func pair(_ raw: String) async throws {
        guard !busy else { throw AppError.message("Espera a que termine la transferencia.") }
        let code = try PairingCode.parse(raw)
        if let old = library.state.link, old.serverId != code.serverId { throw AppError.message("Desvincula primero tu PC anterior. Se conservarán las descargas.") }
        busy = true; detail = "Vinculando con tu PC…"; defer { busy = false }
        let link = try await LANClient.pair(code, name: UIDevice.current.name)
        try library.setLink(link); detail = "PC vinculada. Ya puedes sincronizar."
    }
    func sync() { begin(download: []) }
    func download(_ ids: [String]) { begin(download: ids) }
    func cancel() { work?.cancel(); detail = "Cancelando…" }
    private func begin(download ids: [String]) {
        guard !busy else { return }
        busy = true; progress = 0
        work = Task { [weak self] in
            guard let self else { return }
            defer { self.busy = false; self.work = nil }
            do {
                guard let link = self.library.state.link else { throw AppError.message("Vincula primero tu PC desde Sincronizar.") }
                let client = LANClient(link: link, token: try DeviceKeychain.read(link.serverId))
                self.detail = "Enviando cambios pendientes…"
                let conflicts = Set(self.library.state.conflicts.map(\.id))
                let pending = self.library.state.pending.filter { !conflicts.contains($0.id ?? "") }
                var outgoing = pending
                if let song = self.player.current, !self.library.state.localIds.contains(song.id) {
                    outgoing.append(PendingChange(id: nil, kind: "resume", trackId: song.id, position: self.player.position))
                }
                // Bound both operation count and UTF-8 JSON size; large offline libraries
                // must not exceed the PC's five-megabyte request limit.
                while !outgoing.isEmpty {
                    try Task.checkCancellation()
                    var batch: [PendingChange] = []
                    var size = 0
                    while let change = outgoing.first {
                        let count = try JSONEncoder().encode(change).count
                        if !batch.isEmpty && (batch.count >= 50 || size + count > 3_000_000) { break }
                        batch.append(outgoing.removeFirst()); size += count
                    }
                    let results: [ChangeResult] = try await client.json("changes", body: JSONEncoder().encode(ChangeEnvelope(changes: batch)))
                    for result in results where batch.indices.contains(result.index) {
                        let change = batch[result.index]
                        if result.applied { self.library.acknowledge(change) }
                        else if let conflict = result.conflict { self.library.conflict(change, remote: conflict) }
                        else if let error = result.error { self.library.message = "Un cambio sigue pendiente: " + error }
                    }
                }
                try Task.checkCancellation()
                self.detail = "Leyendo tu biblioteca de la PC…"
                let manifest: Manifest = try await client.json("manifest")
                try self.library.merge(manifest)
                var downloadIds = Set(ids)
                for song in manifest.tracks where self.library.file(song.id) != nil && self.library.state.files[song.id]?.revision != song.fileRevision { downloadIds.insert(song.id) }
                let selected = manifest.tracks.filter { downloadIds.contains($0.id) }
                for (index, song) in selected.enumerated() {
                    try Task.checkCancellation()
                    guard song.fileRevision != nil else { self.library.message = "\(song.title) no está disponible en la PC."; continue }
                    if self.library.state.files[song.id]?.revision != song.fileRevision || self.library.file(song.id) == nil {
                        self.detail = "Descargando \(index + 1)/\(selected.count): \(song.title)"
                        let temporary = try await client.audio(song, resumeFile: self.library.database.resumeURL(song.id))
                        do { try self.library.install(temporary, song: song) } catch { try? FileManager.default.removeItem(at: temporary); throw error }
                    }
                    self.progress = Double(index + 1) / Double(max(1, selected.count))
                }
                let cachedIds = Set(self.library.downloaded.map(\.id))
                let needed = manifest.tracks.filter { cachedIds.contains($0.id) || downloadIds.contains($0.id) }
                for song in needed {
                    try Task.checkCancellation()
                    self.detail = "Actualizando letras y portadas…"
                    if self.library.state.lyrics[song.id]?.revision != song.lyricsRevision,
                       !self.library.state.pending.contains(where: { $0.kind == "lyrics" && $0.id == song.id }) {
                        let payload: LyricPayload = try await client.json("lyrics/" + song.id)
                        self.library.cacheLyrics(song.id, payload: payload)
                    }
                    if let revision = song.coverRevision, self.library.state.coverRevisions[song.id] != revision {
                        let image = try await client.image("cover/" + song.id)
                        try self.library.storeCover(song.id, data: image, revision: revision)
                    }
                }
                for playlist in manifest.playlists {
                    try Task.checkCancellation()
                    let id = "playlist:" + playlist.id
                    if let revision = playlist.coverRevision, self.library.state.coverRevisions[id] != revision {
                        let image = try await client.image("playlist-cover/" + playlist.id)
                        try self.library.storeCover(id, data: image, revision: revision)
                    }
                }
                self.library.finishSync(); self.progress = 1
                self.detail = self.library.state.conflicts.isEmpty ? "Todo al día. Tu música está lista sin conexión." : "Hay letras con cambios en ambos equipos. Revisa los conflictos."
            } catch {
                if Task.isCancelled { self.detail = "Transferencia pausada. Puedes volver a intentarlo." }
                else { self.detail = "No se pudo sincronizar."; self.library.message = error.localizedDescription + "\nComprueba que ambos equipos estén en la misma red y Glass Music esté abierto en la PC." }
            }
        }
    }
}
