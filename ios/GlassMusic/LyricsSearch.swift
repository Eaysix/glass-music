import Foundation
import SwiftUI

struct OnlineLyrics: Decodable, Identifiable {
    var id: Int
    var trackName: String
    var artistName: String
    var albumName: String?
    var duration: Double
    var plainLyrics: String?
    var syncedLyrics: String?
    var text: String { let synced = syncedLyrics?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""; return synced.isEmpty ? plainLyrics ?? "" : synced }
    func matches(_ song: Song) -> Bool {
        func normal(_ value: String) -> String { value.precomposedStringWithCompatibilityMapping.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        return normal(trackName) == normal(song.title) && normal(artistName) == normal(song.artist) && abs(duration - song.duration) <= 2 && !text.isEmpty
    }
}
actor LyricsSearch {
    static let shared = LyricsSearch()
    private var next = Date.distantPast
    private var inFlight = false
    private var cache: [String: [OnlineLyrics]] = [:]
    func search(_ song: Song) async throws -> [OnlineLyrics] {
        var url = URLComponents(string: "https://lrclib.net/api/search")!
        url.queryItems = [URLQueryItem(name: "track_name", value: song.title), URLQueryItem(name: "artist_name", value: song.artist)]
        let key = url.url!.absoluteString
        if let saved = cache[key] { return saved }
        guard !inFlight, Date() >= next else { throw AppError.message("Espera antes de volver a buscar letras en LRCLIB.") }
        inFlight = true
        defer { inFlight = false }
        next = Date().addingTimeInterval(0.8)
        var request = URLRequest(url: url.url!); request.timeoutInterval = 20
        request.setValue("Glass Music iOS 0.6.1 (https://github.com/Eaysix/glass-music)", forHTTPHeaderField: "Lrclib-Client")
        let config = URLSessionConfiguration.ephemeral; config.httpCookieStorage = nil; config.urlCache = nil
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AppError.message("LRCLIB no pudo responder.") }
        if http.statusCode == 429 || http.statusCode == 503 {
            let delay = Double(http.value(forHTTPHeaderField: "Retry-After") ?? "60") ?? 60
            next = Date().addingTimeInterval(max(1, delay) + 0.5)
            throw AppError.message("LRCLIB está ocupado. Espera antes de volver a buscar.")
        }
        guard (200...299).contains(http.statusCode), data.count <= 4 * 1024 * 1024 else { throw AppError.message("No se pudieron descargar las letras de LRCLIB.") }
        let results = Array(try JSONDecoder().decode([OnlineLyrics].self, from: data).filter { !$0.text.isEmpty }.prefix(20))
        if cache.count >= 100 { cache.removeAll(keepingCapacity: true) }
        cache[key] = results
        return results
    }
}
struct LyricsSearchView: View {
    let song: Song
    let apply: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var candidates: [OnlineLyrics] = []
    @State private var busy = false
    @State private var message = ""
    var body: some View {
        NavigationStack {
            List {
                Text("Envía el título y artista a LRCLIB. El audio se queda en tu teléfono. Revisa la versión antes de reemplazar tu borrador.").font(.caption)
                Button(busy ? "Buscando…" : "Buscar letra en LRCLIB") {
                    busy = true; message = ""
                    Task { @MainActor in
                        defer { busy = false }
                        do { candidates = try await LyricsSearch.shared.search(song); if candidates.isEmpty { message = "Sin coincidencias. Puedes escribirla manualmente." } }
                        catch { message = error.localizedDescription }
                    }
                }.disabled(busy)
                if !message.isEmpty { Text(message).font(.caption) }
                ForEach(candidates) { candidate in
                    NavigationLink {
                        ScrollView {
                            VStack(alignment: .leading, spacing: 16) {
                                Text(candidate.trackName).font(.title2.bold()); Text(candidate.artistName)
                                Text(candidate.text).font(.body.monospaced())
                                Button("Usar esta letra en el borrador") { apply(candidate.text); dismiss() }.buttonStyle(.borderedProminent)
                            }.padding()
                        }.navigationTitle(candidate.syncedLyrics?.isEmpty == false ? "Sincronizada por líneas" : "Texto sin tiempos")
                    } label: {
                        VStack(alignment: .leading) { Text(candidate.trackName); Text("\(candidate.artistName) · \(Int(candidate.duration)) s · \(candidate.syncedLyrics?.isEmpty == false ? "Sincronizada" : "Texto")").font(.caption).foregroundStyle(.secondary) }
                    }
                }
            }.navigationTitle("Buscar letra").toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cerrar") { dismiss() } } }
        }.preferredColorScheme(.dark)
    }
}
