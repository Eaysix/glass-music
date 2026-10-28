import XCTest
@testable import GlassMusic

final class GlassMusicTests: XCTestCase {
    func testPairingRejectsPublicAddressesExpiredCodesAndInvalidPins() throws {
        let now = Date()
        var code = PairingCode(protocolVersion: 1, serverId: "pc", host: "192.168.68.120", port: 38473, fingerprint: String(repeating: "a", count: 64), secret: String(repeating: "b", count: 64), expiresAt: now.timeIntervalSince1970 * 1000 + 300000)
        func raw(_ value: PairingCode) throws -> String { String(data: try JSONEncoder().encode(value), encoding: .utf8)! }
        XCTAssertEqual(try PairingCode.parse(raw(code), date: now).host, code.host)
        for host in ["8.8.8.8", "example.com", "192.168.1.1.attacker.com", "127.0.0.1", "192.168.001.1", "172.32.0.1", "256.1.1.1"] {
            code.host = host; XCTAssertThrowsError(try PairingCode.parse(raw(code), date: now))
        }
        code.host = "10.0.0.2"; code.fingerprint = "invalid"; XCTAssertThrowsError(try PairingCode.parse(raw(code), date: now))
        code.fingerprint = String(repeating: "a", count: 64); code.expiresAt = 0; XCTAssertThrowsError(try PairingCode.parse(raw(code), date: now))
    }
    func testEnhancedLyricsOffsetsVoicesRepeatedVersesAndChineseSpacing() {
        let lines = Lyrics.parse("[offset:100]\n[00:01.000][00:04.000]v3:<00:01.000>Hola <00:02.000>mundo\n[00:08]<00:08>你好<00:09>世界")
        XCTAssertEqual(lines.count, 3)
        XCTAssertEqual(lines[0].time, 1.1, accuracy: 0.001)
        XCTAssertEqual(lines[1].words[1].time, 5.1, accuracy: 0.001)
        XCTAssertEqual(lines[2].words.map { $0.text + $0.separator }.joined(), "你好世界")
        XCTAssertNil(Lyrics.active(lines, at: 0))
        XCTAssertEqual(Lyrics.active(lines, at: 4.5), 1)
        XCTAssertEqual(lines[0].text, "Hola mundo")
    }
    func testWrappingAndDuplicateWordTagsAreClean() {
        let lines = Lyrics.parse("[00:01]v2:<00:01>Una <00:02><00:02>letra\n<00:03>guardada")
        XCTAssertEqual(lines.count, 1)
        XCTAssertEqual(lines[0].text, "Una letra guardada")
        XCTAssertEqual(lines[0].words.map(\.text), ["Una", "letra", "guardada"])
    }
    @MainActor func testLibraryKeepsLocalLyricsOnManifestRefreshAndPersistsPendingChanges() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let db = try SnapshotDatabase(root: folder)
        let library = try Library(database: db)
        try library.setLink(Link(serverId: "pc", host: "192.168.1.2", port: 38473, fingerprint: String(repeating: "a", count: 64), deviceId: "iphone"))
        let song = Song(id: "one", title: "Canción", artist: "Artista", album: "Álbum", duration: 180, format: "FLAC", lyricsRevision: digest(Data("PC".utf8)))
        let manifest = Manifest(protocolVersion: 1, serverId: "pc", libraryName: "Mi música", accent: "#8CCDF3", tracks: [song], playlists: [], resumes: [])
        try library.merge(manifest); library.cacheLyrics("one", payload: LyricPayload(text: "PC", revision: song.lyricsRevision))
        library.editLyrics("one", text: "[00:01]<00:01>Mi <00:02>letra")
        try library.merge(manifest)
        library.cacheLyrics("one", payload: LyricPayload(text: "Otra edición en PC", revision: "new"))
        XCTAssertTrue(library.state.lyrics["one"]!.text.contains("Mi"))
        db.flush()
        let restored = try db.load()
        XCTAssertEqual(restored.pending.count, 1)
        XCTAssertEqual(restored.pending[0].baseRevision, song.lyricsRevision)
        XCTAssertEqual(restored.lyrics["one"]?.text, library.state.lyrics["one"]?.text)
    }
    @MainActor func testLyricConflictRetainsBothVersionsUntilExplicitChoice() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString); defer { try? FileManager.default.removeItem(at: folder) }
        let library = try Library(database: SnapshotDatabase(root: folder))
        try library.setLink(Link(serverId: "pc", host: "10.0.0.2", port: 38473, fingerprint: "a", deviceId: "phone"))
        library.editLyrics("one", text: "iPhone")
        let change = try XCTUnwrap(library.state.pending.first)
        library.conflict(change, remote: LyricPayload(text: "PC", revision: "remote"))
        XCTAssertEqual(library.state.conflicts[0].change.text, "iPhone")
        XCTAssertEqual(library.state.conflicts[0].remote.text, "PC")
        library.resolve(library.state.conflicts[0], keepMine: true)
        XCTAssertEqual(library.state.pending.first?.baseRevision, "remote")
        XCTAssertEqual(library.state.lyrics["one"]?.text, "iPhone")
    }
    func testProtocolOperationsAndSnapshotsRoundTripUnicode() throws {
        let change = PendingChange(id: "abc", kind: "lyrics", baseRevision: "old", text: "[00:01]Canción 世界 🎵")
        let decoded = try JSONDecoder().decode(ChangeEnvelope.self, from: JSONEncoder().encode(ChangeEnvelope(changes: [change])))
        XCTAssertEqual(decoded.changes[0].text, change.text)
        XCTAssertEqual(digest(Data()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    }
    @MainActor func testNativeClientPairsDownloadsAndSyncsWithRealPCHub() async throws {
        guard let fixture = Bundle(for: Self.self).url(forResource: "HubFixture", withExtension: "json") else {
            throw XCTSkip("Run the Rust test_hub fixture to exercise the native LAN client.")
        }
        let code = try JSONDecoder().decode(PairingCode.self, from: Data(contentsOf: fixture))
        // Loopback is allowed only for this in-process Simulator fixture. QR parsing
        // in the app still rejects loopback and public addresses.
        let link = try await LANClient.pair(code, name: "Simulator integration test")
        defer { DeviceKeychain.remove(link.serverId) }
        let client = LANClient(link: link, token: try DeviceKeychain.read(link.serverId))
        let manifest: Manifest = try await client.json("manifest")
        XCTAssertEqual(manifest.tracks.count, 2)
        let song = try XCTUnwrap(manifest.tracks.first(where: { $0.id == "first" }))
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let library = try Library(database: SnapshotDatabase(root: folder))
        try library.setLink(link); try library.merge(manifest)
        let file = try await client.audio(song, resumeFile: library.database.resumeURL(song.id))
        try library.install(file, song: song)
        let stored = try XCTUnwrap(library.file(song.id))
        XCTAssertEqual(try Data(contentsOf: stored).prefix(4), Data("fLaC".utf8))
        XCTAssertEqual(try FileManager.default.attributesOfItem(atPath: stored.path)[.size] as? Int64, song.fileSize)
        let lyrics: LyricPayload = try await client.json("lyrics/first")
        library.cacheLyrics(song.id, payload: lyrics)
        let text = "[00:01]<00:01>Letra <00:02>del iPhone 世界"
        let edit = PendingChange(id: song.id, kind: "lyrics", baseRevision: lyrics.revision, text: text)
        let applied: [ChangeResult] = try await client.json("changes", body: JSONEncoder().encode(ChangeEnvelope(changes: [edit])))
        XCTAssertTrue(try XCTUnwrap(applied.first).applied)
        let refreshed: LyricPayload = try await client.json("lyrics/first")
        XCTAssertEqual(refreshed.text, text)
        let stale = PendingChange(id: song.id, kind: "lyrics", baseRevision: lyrics.revision, text: "Otra edición")
        let rejected: [ChangeResult] = try await client.json("changes", body: JSONEncoder().encode(ChangeEnvelope(changes: [stale])))
        XCTAssertFalse(try XCTUnwrap(rejected.first).applied)
        XCTAssertEqual(rejected.first?.conflict?.text, text)
        var incorrect = link; incorrect.fingerprint = String(repeating: "0", count: 64)
        do {
            let _: Manifest = try await LANClient(link: incorrect, token: try DeviceKeychain.read(link.serverId)).json("manifest")
            XCTFail("A server certificate that differs from the QR must be rejected")
        } catch { /* Expected: the TLS certificate pin differs. */ }
        XCTAssertNotNil(library.file(song.id)) // The downloaded file remains available offline.
    }

}
