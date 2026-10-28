import Foundation
import AVFoundation
import UIKit

@MainActor final class Library: ObservableObject {
    @Published private(set) var state: LibraryState
    @Published var message: String?
    let database: SnapshotDatabase
    var catalogChanged: (() -> Void)?
    init(database: SnapshotDatabase) throws { self.database = database; state = try database.load() }
    func persist() {
        database.save(state) { [weak self] error in if let error { Task { @MainActor in self?.message = error.localizedDescription } } }
    }
    func file(_ id: String) -> URL? {
        guard let entry = state.files[id] else { return nil }
        let url = database.root.appendingPathComponent(entry.relativePath).standardizedFileURL
        guard url.path.hasPrefix(database.root.path + "/"), FileManager.default.fileExists(atPath: url.path) else { return nil }
        return url
    }
    func cover(_ id: String) -> UIImage? { UIImage(contentsOfFile: database.coverURL(id).path) }
    var downloaded: [Song] { state.songs.filter { file($0.id) != nil } }
    func setLink(_ link: Link) throws {
        if let current = state.link, current.serverId != link.serverId {
            throw AppError.message("Desvincula la PC anterior antes de conectar otra. Tus descargas se conservarán.")
        }
        state.link = link; persist()
    }
    func unlink() {
        if let link = state.link { DeviceKeychain.remove(link.serverId) }
        state.localIds.formUnion(state.songs.filter { file($0.id) != nil }.map(\.id))
        state.link = nil; state.pending.removeAll(); state.conflicts.removeAll(); state.resumes.removeAll(); persist()
    }
    func merge(_ manifest: Manifest) throws {
        guard manifest.protocolVersion == 1, manifest.serverId == state.link?.serverId else { throw AppError.message("La PC y el iPhone no usan el mismo protocolo.") }
        let remoteIds = Set(manifest.tracks.map(\.id))
        let local = state.songs.filter { state.localIds.contains($0.id) || (!remoteIds.contains($0.id) && file($0.id) != nil) }
        state.localIds.formUnion(local.map(\.id))
        state.songs = manifest.tracks + local.filter { !remoteIds.contains($0.id) }
        for pending in state.pending where pending.kind == "favorite" {
            if let index = state.songs.firstIndex(where: { $0.id == pending.id }), let value = pending.value { state.songs[index].favorite = value }
        }
        state.playlists = manifest.playlists
        state.name = manifest.libraryName; state.accent = manifest.accent; state.resumes = manifest.resumes
        persist(); catalogChanged?()
    }
    func cacheLyrics(_ id: String, payload: LyricPayload) {
        guard !state.pending.contains(where: { $0.kind == "lyrics" && $0.id == id }) else { return }
        state.lyrics[id] = payload; persist()
    }
    func editLyrics(_ id: String, text: String) {
        guard text.utf8.count <= 1024 * 1024 else { message = "La letra supera 1 MB."; return }
        let base = state.pending.first(where: { $0.kind == "lyrics" && $0.id == id })?.baseRevision ?? state.lyrics[id]?.revision ?? state.songs.first(where: { $0.id == id })?.lyricsRevision ?? digest(Data())
        state.lyrics[id] = LyricPayload(text: text, revision: base)
        if !state.localIds.contains(id), state.link != nil {
            state.pending.removeAll { $0.kind == "lyrics" && $0.id == id }
            state.pending.append(PendingChange(id: id, kind: "lyrics", baseRevision: base, text: text))
        }
        persist()
    }
    func favorite(_ id: String) {
        guard let index = state.songs.firstIndex(where: { $0.id == id }) else { return }
        state.songs[index].favorite.toggle()
        if !state.localIds.contains(id), state.link != nil {
            state.pending.removeAll { $0.kind == "favorite" && $0.id == id }
            state.pending.append(PendingChange(id: id, kind: "favorite", value: state.songs[index].favorite))
        }
        persist()
    }
    func acknowledge(_ change: PendingChange) {
        state.pending.removeAll { $0.operationId == change.operationId }
        if change.kind == "lyrics", let id = change.id, let text = change.text { state.lyrics[id] = LyricPayload(text: text, revision: digest(Data(text.utf8))) }
        persist()
    }
    func conflict(_ change: PendingChange, remote: LyricPayload) {
        state.conflicts.removeAll { $0.id == change.id }; state.conflicts.append(SyncConflict(id: change.id ?? change.operationId, change: change, remote: remote)); persist()
    }
    func resolve(_ conflict: SyncConflict, keepMine: Bool) {
        state.conflicts.removeAll { $0.id == conflict.id }
        state.pending.removeAll { $0.operationId == conflict.change.operationId }
        if keepMine {
            var change = conflict.change; change.baseRevision = conflict.remote.revision; state.pending.append(change)
        } else { state.lyrics[conflict.id] = conflict.remote }
        persist()
    }
    func install(_ url: URL, song: Song) throws {
        let count = try FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber
        guard let expected = song.fileSize, count?.int64Value == expected else { throw AppError.message("La descarga quedó incompleta. Vuelve a sincronizar.") }
        let destination = database.mediaURL(song.id, format: song.format)
        if FileManager.default.fileExists(atPath: destination.path) { _ = try FileManager.default.replaceItemAt(destination, withItemAt: url) }
        else { try FileManager.default.moveItem(at: url, to: destination) }
        state.files[song.id] = OfflineFile(relativePath: "Audio/" + destination.lastPathComponent, revision: song.fileRevision ?? "")
        persist(); catalogChanged?()
    }
    func createLocalPlaylist(name: String, ids: [String]) {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        state.localPlaylists.append(Playlist(id: "local-" + UUID().uuidString.lowercased(), name: name.trimmingCharacters(in: .whitespaces), trackIds: ids, revision: "local")); persist(); catalogChanged?()
    }
    func removeDownload(_ id: String) {
        do { if let file = file(id) { try FileManager.default.removeItem(at: file) }; state.files.removeValue(forKey: id); persist(); catalogChanged?() }
        catch { message = error.localizedDescription }
    }
    func storeCover(_ id: String, data: Data, revision: String) throws {
        guard UIImage(data: data) != nil else { return }
        try data.write(to: database.coverURL(id), options: .atomic); state.coverRevisions[id] = revision; persist()
    }
    func remember(_ id: String?, position: Double) { state.currentId = id; state.position = max(0, position.isFinite ? position : 0); persist() }
    func finishSync() { state.lastSync = Date(); persist() }
    func importFiles(_ urls: [URL]) async {
        for url in urls {
            let access = url.startAccessingSecurityScopedResource(); defer { if access { url.stopAccessingSecurityScopedResource() } }
            do {
                let format = url.pathExtension.uppercased()
                guard ["FLAC", "MP3"].contains(format) else { throw AppError.message("Elige un archivo FLAC o MP3.") }
                let id = "local-" + UUID().uuidString.lowercased()
                let destination = database.mediaURL(id, format: format)
                try await Task.detached { try FileManager.default.copyItem(at: url, to: destination) }.value
                let asset = AVURLAsset(url: destination)
                guard try await asset.load(.isPlayable) else { try? FileManager.default.removeItem(at: destination); throw AppError.message("iOS no pudo reproducir este archivo.") }
                let metadata = try await asset.load(.commonMetadata)
                func string(_ key: AVMetadataIdentifier) async -> String? {
                    guard let item = AVMetadataItem.metadataItems(from: metadata, filteredByIdentifier: key).first else { return nil }
                    return try? await item.load(.stringValue)
                }
                let duration = try await asset.load(.duration).seconds
                let title = await string(.commonIdentifierTitle) ?? url.deletingPathExtension().lastPathComponent
                let artist = await string(.commonIdentifierArtist) ?? "Artista desconocido"
                let album = await string(.commonIdentifierAlbumName) ?? "Sin álbum"
                let song = Song(id: id, title: title, artist: artist, album: album, duration: duration.isFinite ? duration : 0, format: format, modifiedAt: Date().timeIntervalSince1970 * 1000, lyricsRevision: digest(Data()))
                state.songs.append(song); state.localIds.insert(id)
                state.files[id] = OfflineFile(relativePath: "Audio/" + destination.lastPathComponent, revision: "local")
                if let item = AVMetadataItem.metadataItems(from: metadata, filteredByIdentifier: .commonIdentifierArtwork).first,
                   let bytes = try? await item.load(.dataValue), let image = UIImage(data: bytes) {
                    let scale = min(1, 512 / max(image.size.width, image.size.height))
                    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                    let preview = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
                    if let data = preview.jpegData(compressionQuality: 0.85) { try data.write(to: database.coverURL(id), options: .atomic) }
                }
                persist(); catalogChanged?()
            } catch { message = error.localizedDescription }
        }
    }
}
