import Foundation
import SQLite3

final class SnapshotDatabase {
    private let queue = DispatchQueue(label: "com.eaysix.glassmusic.storage")
    private var database: OpaquePointer?
    let root: URL
    init(root: URL? = nil) throws {
        self.root = try root ?? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true).appendingPathComponent("GlassMusic", isDirectory: true)
        try FileManager.default.createDirectory(at: self.root, withIntermediateDirectories: true)
        for folder in ["Audio", "Covers", "Transfers"] {
            var url = self.root.appendingPathComponent(folder, isDirectory: true)
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
        }
        guard sqlite3_open_v2(self.root.appendingPathComponent("library.sqlite").path, &database, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { throw AppError.message("No se pudo abrir tu biblioteca local.") }
        guard sqlite3_exec(database, "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS library(id INTEGER PRIMARY KEY CHECK(id=1), snapshot BLOB NOT NULL);", nil, nil, nil) == SQLITE_OK else { throw AppError.message("No se pudo preparar tu biblioteca.") }
    }
    deinit { sqlite3_close(database) }
    func load() throws -> LibraryState {
        try queue.sync {
            var statement: OpaquePointer?
            guard sqlite3_prepare_v2(database, "SELECT snapshot FROM library WHERE id=1", -1, &statement, nil) == SQLITE_OK else { throw AppError.message("No se pudo leer la biblioteca.") }
            defer { sqlite3_finalize(statement) }
            guard sqlite3_step(statement) == SQLITE_ROW else { return LibraryState() }
            let count = Int(sqlite3_column_bytes(statement, 0))
            guard let bytes = sqlite3_column_blob(statement, 0) else { return LibraryState() }
            return try JSONDecoder().decode(LibraryState.self, from: Data(bytes: bytes, count: count))
        }
    }
    func save(_ state: LibraryState, completion: @escaping (Error?) -> Void = { _ in }) {
        queue.async {
            do {
                let data = try JSONEncoder().encode(state)
                var statement: OpaquePointer?
                guard sqlite3_prepare_v2(self.database, "INSERT INTO library VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot", -1, &statement, nil) == SQLITE_OK else { throw AppError.message("No se pudieron preparar los cambios.") }
                defer { sqlite3_finalize(statement) }
                let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
                let bound = data.withUnsafeBytes { sqlite3_bind_blob(statement, 1, $0.baseAddress, Int32(data.count), transient) }
                guard bound == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else { throw AppError.message("No se pudieron guardar los cambios locales.") }
                completion(nil)
            } catch { completion(error) }
        }
    }
    func flush() { queue.sync {} }
    func mediaURL(_ id: String, format: String) -> URL {
        root.appendingPathComponent("Audio").appendingPathComponent(digest(Data(id.utf8)) + (format.uppercased() == "FLAC" ? ".flac" : ".mp3"))
    }
    func coverURL(_ id: String) -> URL { root.appendingPathComponent("Covers").appendingPathComponent(digest(Data(id.utf8)) + ".image") }
    func resumeURL(_ id: String) -> URL { root.appendingPathComponent("Transfers").appendingPathComponent(digest(Data(id.utf8)) + ".resume") }
}
