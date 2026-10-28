import Foundation
import CryptoKit

struct Song: Codable, Identifiable, Equatable {
    var id: String
    var title: String
    var artist: String
    var album: String
    var feats: String = ""
    var duration: Double
    var format: String
    var sampleRate: Int?
    var bitDepth: Int?
    var favorite: Bool = false
    var modifiedAt: Double?
    var fileSize: Int64?
    var fileRevision: String?
    var coverRevision: String?
    var lyricsRevision: String
}
struct Playlist: Codable, Identifiable, Equatable {
    var id: String
    var name: String
    var trackIds: [String]
    var revision: String
    var coverRevision: String?
}
struct ResumePoint: Codable, Identifiable {
    var id: String { deviceId }
    var deviceId: String
    var deviceName: String
    var trackId: String
    var position: Double
    var updatedAt: Double
}
struct Manifest: Codable {
    var protocolVersion: Int
    var serverId: String
    var libraryName: String
    var accent: String
    var tracks: [Song]
    var playlists: [Playlist]
    var resumes: [ResumePoint]
}
struct LyricPayload: Codable { var text: String; var revision: String }
struct Link: Codable {
    var serverId: String
    var host: String
    var port: Int
    var fingerprint: String
    var deviceId: String
    var baseURL: URL { URL(string: "https://\(host):\(port)")! }
}
struct PairingCode: Codable {
    var protocolVersion: Int
    var serverId: String
    var host: String
    var port: Int
    var fingerprint: String
    var secret: String
    var expiresAt: Double
    static func parse(_ text: String, date: Date = Date()) throws -> PairingCode {
        guard text.utf8.count < 8192 else { throw AppError.message("El código es demasiado largo.") }
        let data: Data
        if let url = URLComponents(string: text), url.scheme == "glassmusic", url.host == "pair",
           let payload = url.queryItems?.first(where: { $0.name == "data" })?.value,
           let decoded = Data(base64Encoded: payload) { data = decoded }
        else { data = Data(text.utf8) }
        let code = try JSONDecoder().decode(Self.self, from: data)
        guard code.protocolVersion == 1, privateIPv4(code.host), (1...65535).contains(code.port),
              code.fingerprint.count == 64, code.fingerprint.allSatisfy({ $0.isHexDigit }),
              code.secret.count == 64, code.secret.allSatisfy({ $0.isHexDigit }),
              code.expiresAt > date.timeIntervalSince1970 * 1000 else {
            throw AppError.message("El QR expiró o no corresponde a una PC en tu red local. Genera otro en Glass Music.")
        }
        return code
    }
    static func privateIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        let bytes = parts.compactMap { part -> UInt8? in
            guard part == "0" || !part.hasPrefix("0") else { return nil }
            return UInt8(part)
        }
        guard bytes.count == 4 else { return false }
        return bytes[0] == 10 || (bytes[0] == 192 && bytes[1] == 168) ||
            (bytes[0] == 172 && (16...31).contains(bytes[1])) || (bytes[0] == 169 && bytes[1] == 254)
    }
}
struct PairResponse: Codable { var deviceId: String; var serverId: String; var token: String }
struct PendingChange: Codable, Identifiable {
    var operationId: String = UUID().uuidString
    var id: String? // Song ID in the protocol; operationId is the local queue identifier.
    var kind: String
    var baseRevision: String?
    var text: String?
    var value: Bool?
    var trackId: String?
    var position: Double?
}
struct ChangeEnvelope: Codable { var changes: [PendingChange] }
struct SyncConflict: Codable, Identifiable {
    var id: String
    var change: PendingChange
    var remote: LyricPayload
}
struct ChangeResult: Codable {
    var index: Int
    var applied: Bool
    var error: String?
    var conflict: LyricPayload?
}
struct OfflineFile: Codable {
    var relativePath: String
    var revision: String
}
struct PhoneQueue: Codable {
    var shuffle: Bool?
    var repeatAll: Bool?
    var collection: String
    var context: [String]
    var upcoming: [String]
    var history: [String]
    var heard: Set<String>
}
struct LibraryState: Codable {
    var phoneAppearance: PhoneAppearance?
    var queue: PhoneQueue?
    var songs: [Song] = []
    var playlists: [Playlist] = []
    var localPlaylists: [Playlist] = []
    var files: [String: OfflineFile] = [:]
    var lyrics: [String: LyricPayload] = [:]
    var coverRevisions: [String: String] = [:]
    var localIds: Set<String> = []
    var pending: [PendingChange] = []
    var conflicts: [SyncConflict] = []
    var link: Link?
    var accent: String = "#8CCDF3"
    var name: String = "Mi espacio"
    var resumes: [ResumePoint] = []
    var currentId: String?
    var position: Double = 0
    var lastSync: Date?
}
enum AppError: LocalizedError {
    case message(String)
    var errorDescription: String? { switch self { case .message(let message): return message } }
}
func digest(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
