import Foundation
import SwiftUI

private final class ServerSessionDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor final class ServerCatalog: ObservableObject {
    struct Link: Codable {
        let origin: URL
        let serverId: String
    }
    private struct Invitation: Decodable { let origin: URL; let secret: String }
    private struct PairResult: Decodable { let token: String; let serverId: String }
    private struct Ticket: Decodable { let path: String }
    private struct ResultSong: Decodable {
        let id: String
        let title: String
        let artist: String
        let album: String
        let duration: Double
        let format: String
    }

    @Published private(set) var link: Link?
    @Published var cellular: Bool { didSet { defaults.set(cellular, forKey: "glass-server-cellular") } }
    private let defaults = UserDefaults.standard
    private let preference = "glass-server-link"
    init() {
        cellular = defaults.bool(forKey: "glass-server-cellular")
        link = defaults.data(forKey: preference).flatMap { try? JSONDecoder().decode(Link.self, from: $0) }
    }
    private func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.allowsCellularAccess = cellular
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 600
        return URLSession(configuration: config, delegate: ServerSessionDelegate(), delegateQueue: nil)
    }
    private func request<T: Decodable>(_ url: URL, token: String? = nil, body: [String: String]? = nil) async throws -> T {
        var request = URLRequest(url: url)
        if let token { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let session = session()
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        try verify(response)
        return try JSONDecoder().decode(T.self, from: data)
    }
    private func verify(_ response: URLResponse) throws {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw AppError.message(status == 401 ? "El servidor rechazó la vinculación. Revisa el código o genera uno nuevo." : "El servidor de música no completó la solicitud (\(status)).")
        }
    }
    func pair(_ code: String) async throws {
        let data = Data(code.trimmingCharacters(in: .whitespacesAndNewlines).utf8)
        guard data.count < 4096 else { throw AppError.message("El código es demasiado largo.") }
        let invite = try JSONDecoder().decode(Invitation.self, from: data)
        guard invite.origin.scheme == "https", invite.origin.host != nil, invite.origin.user == nil, invite.origin.password == nil,
              ["", "/"].contains(invite.origin.path), invite.origin.query == nil, invite.origin.fragment == nil,
              invite.secret.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else {
            throw AppError.message("Usa una invitación HTTPS del servidor de Glass Music.")
        }
        let result: PairResult = try await request(invite.origin.appendingPathComponent("v1/pair"), body: ["secret": invite.secret, "name": "Glass Music iPhone"])
        guard result.serverId.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil,
              result.token.range(of: "^[a-f0-9]{64}$", options: .regularExpression) != nil else { throw AppError.message("La respuesta del servidor no es válida.") }
        let next = Link(origin: invite.origin, serverId: result.serverId)
        try DeviceKeychain.save(result.token, for: "catalog:" + next.serverId)
        defaults.set(try JSONEncoder().encode(next), forKey: preference)
        if let old = link, old.serverId != next.serverId { DeviceKeychain.remove("catalog:" + old.serverId) }
        link = next
    }
    func unlink() {
        if let link { DeviceKeychain.remove("catalog:" + link.serverId) }
        defaults.removeObject(forKey: preference)
        link = nil
    }
    func canPlay(_ song: Song) -> Bool {
        guard let link else { return false }
        return song.id.hasPrefix("server-" + link.serverId + "-")
    }
    func search(_ query: String) async throws -> [Song] {
        guard let link else { return [] }
        var url = URLComponents(url: link.origin.appendingPathComponent("v1/search"), resolvingAgainstBaseURL: false)!
        url.queryItems = [URLQueryItem(name: "q", value: query)]
        let songs: [ResultSong] = try await request(url.url!, token: DeviceKeychain.read("catalog:" + link.serverId))
        return songs.map {
            Song(id: "server-" + link.serverId + "-" + $0.id, title: $0.title, artist: $0.artist, album: $0.album, duration: $0.duration, format: $0.format.uppercased(), lyricsRevision: digest(Data()))
        }
    }
    func audioURL(_ song: Song) async throws -> URL {
        guard let link, canPlay(song) else { throw AppError.message("Vincula el servidor de esta canción.") }
        let id = String(song.id.dropFirst("server-".count + link.serverId.count + 1))
        let format = song.format.lowercased()
        let ticket: Ticket = try await request(link.origin.appendingPathComponent("v1/ticket"), token: DeviceKeychain.read("catalog:" + link.serverId), body: ["id": id, "format": format])
        guard let url = URL(string: ticket.path, relativeTo: link.origin)?.absoluteURL,
              url.scheme == "https", url.host == link.origin.host, url.port == link.origin.port,
              url.path == "/v1/audio/\(id).\(format)" else { throw AppError.message("El enlace de audio no es válido.") }
        return url
    }
    func download(_ song: Song, into library: Library) async throws {
        let url = try await audioURL(song)
        let session = session()
        defer { session.finishTasksAndInvalidate() }
        let (file, response) = try await session.download(from: url)
        defer { try? FileManager.default.removeItem(at: file) }
        try verify(response)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              response.mimeType == (song.format == "FLAC" ? "audio/flac" : "audio/mpeg"),
              response.expectedContentLength > 0 else { throw AppError.message("La descarga no entregó un archivo completo.") }
        var stored = song
        stored.fileSize = response.expectedContentLength
        try library.install(file, song: stored)
        library.saveServerSong(stored, addToLibrary: false)
    }
}

struct ServerSearchResults: View {
    @EnvironmentObject private var library: Library
    @ObservedObject var catalog: ServerCatalog
    let player: MusicPlayer
    let query: String
    @State private var results: [Song] = []
    @State private var error: String?
    @State private var loading = false
    @State private var invitation = ""
    @State private var scanner = false
    @State private var linking = false
    @State private var downloads: Set<String> = []

    var body: some View {
        Group {
            if catalog.link == nil {
                Section("Vincular servidor") {
                    Button("Escanear QR", systemImage: "qrcode.viewfinder") { scanner = true }
                    TextField("Pega el código del homelab", text: $invitation, axis: .vertical)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    Toggle("Permitir datos móviles", isOn: $catalog.cellular)
                    Button("Vincular") { pair(invitation) }.disabled(invitation.isEmpty || linking)
                }
            } else {
                Section("Servidor") {
                    Toggle("Permitir datos móviles", isOn: $catalog.cellular)
                    Button("Desvincular servidor", role: .destructive) { catalog.unlink() }
                    if query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 { Text("Busca por canción, artista o álbum.").foregroundStyle(.secondary) }
                    else if loading { ProgressView("Buscando…") }
                    else if results.isEmpty && error == nil { Text("Sin resultados").foregroundStyle(.secondary) }
                    ForEach(results) { song in
                        HStack {
                            Button { player.playServer(song, results: results) } label: {
                                VStack(alignment: .leading) {
                                    Text(song.title).foregroundStyle(.primary)
                                    Text([song.artist, song.album].filter { !$0.isEmpty }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Menu {
                                Button("Añadir a cola", systemImage: "text.line.first.and.arrowtriangle.forward") { player.enqueueServer(song) }
                                Button("Agregar a mi biblioteca", systemImage: "plus") { library.saveServerSong(song, addToLibrary: true) }
                                Button("Descargar", systemImage: "arrow.down.circle") { download(song) }
                                    .disabled(library.isDownloaded(song.id) || downloads.contains(song.id))
                            } label: { Image(systemName: "ellipsis.circle").frame(width: 44, height: 44) }
                            .accessibilityLabel("Opciones de \(song.title)")
                        }
                    }
                }
            }
            if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
        }
        .sheet(isPresented: $scanner) { QRScanner { value in scanner = false; pair(value) } }
        .task(id: SearchKey(query: query, origin: catalog.link?.origin, cellular: catalog.cellular)) {
            results = []; loading = false
            let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
            guard text.count >= 2, catalog.link != nil else { return }
            error = nil; loading = true
            do {
                try await Task.sleep(for: .milliseconds(300))
                let found = try await catalog.search(text)
                guard !Task.isCancelled else { return }
                results = found; loading = false
            } catch {
                guard !Task.isCancelled else { return }
                self.error = error.localizedDescription; loading = false
            }
        }
    }
    private struct SearchKey: Equatable { let query: String; let origin: URL?; let cellular: Bool }
    private func pair(_ value: String) {
        guard !linking else { return }
        linking = true; error = nil
        Task {
            defer { linking = false }
            do { try await catalog.pair(value); invitation = "" }
            catch { self.error = error.localizedDescription }
        }
    }
    private func download(_ song: Song) {
        guard downloads.insert(song.id).inserted else { return }
        Task {
            defer { downloads.remove(song.id) }
            do { try await catalog.download(song, into: library); library.message = "Disponible sin conexión." }
            catch { self.error = error.localizedDescription }
        }
    }
}
