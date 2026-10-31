import AVFoundation
import XCTest
@testable import GlassMusic

final class GlassMusicTests: XCTestCase {
    @MainActor func testNaturalPlaybackFromZeroAdvancesClockAcrossBothFormats() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try Library(database: SnapshotDatabase(root: root))
        let files = try ["first.flac", "second.mp3"].map { name in
            try XCTUnwrap(Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "Fixtures") ?? Bundle.main.url(forResource: name, withExtension: nil))
        }
        let ids = await library.importFiles(files)
        let songs = ids.compactMap { id in library.downloaded.first { $0.id == id } }
        XCTAssertEqual(songs.count, 2)
        let player = MusicPlayer(library: library)
        defer { player.pause() }
        player.play(songs[0], ids: ids)
        // No seek: reproduce the reported path, including the natural EOF transition.
        for _ in 0..<200 {
            if player.current?.id == songs[1].id && player.position > 2 { break }
            try await Task.sleep(nanoseconds: 150_000_000)
        }
        XCTAssertEqual(player.current?.id, songs[1].id)
        XCTAssertGreaterThan(player.position, 2)
        XCTAssertLessThan(player.position, 10)
        for _ in 0..<160 {
            if !player.playing { break }
            try await Task.sleep(nanoseconds: 150_000_000)
        }
        XCTAssertFalse(player.playing)
        XCTAssertEqual(player.position, player.duration, accuracy: 0.2)
        player.resume()
        try await Task.sleep(nanoseconds: 2_000_000_000)
        XCTAssertGreaterThan(player.position, 0.5)
        XCTAssertLessThan(player.position, 5)
    }
    func testOnlineLyricsKeepProvidedTimingAndRequireTheSameRecordingForBatch() {
        let result = OnlineLyrics(id: 1, trackName: "Canción (En Vivo)", artistName: "Artista", albumName: "Álbum", duration: 200, plainLyrics: "Texto", syncedLyrics: "[00:01]Texto")
        var song = Song(id: "test", title: "Canción (En Vivo)", artist: "Artista", album: "Álbum", duration: 201, format: "FLAC", lyricsRevision: "")
        XCTAssertTrue(result.matches(song))
        XCTAssertEqual(result.text, "[00:01]Texto")
        song.title = "Canción"; XCTAssertFalse(result.matches(song))
        song.title = result.trackName; song.duration = 230; XCTAssertFalse(result.matches(song))
    }
    func testOldOfflineFileWithoutMeasuredDurationStillDecodes() throws {
        let file = try JSONDecoder().decode(OfflineFile.self, from: Data(#"{"relativePath":"Audio/one.flac","revision":"old"}"#.utf8))
        XCTAssertNil(file.duration)
    }
    @MainActor func testRealFileDurationOverridesShortAndLongCatalogValues() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try SnapshotDatabase(root: root), library = try Library(database: database)
        let names = ["first.flac", "second.mp3"]
        var songs: [Song] = []
        try library.setLink(Link(serverId: "duration-test", host: "10.0.0.2", port: 38473, fingerprint: "a", deviceId: "phone"))
        for (index, name) in names.enumerated() {
            let fixture = try XCTUnwrap(Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "Fixtures") ?? Bundle.main.url(forResource: name, withExtension: nil))
            let size = (try FileManager.default.attributesOfItem(atPath: fixture.path)[.size] as? NSNumber)?.int64Value
            let song = Song(id: "duration-\(index)", title: name, artist: "Test", album: "Test", duration: index == 0 ? 3 : 40, format: index == 0 ? "FLAC" : "MP3", fileSize: size, fileRevision: "first-revision", lyricsRevision: "")
            songs.append(song)
            let copy = root.appendingPathComponent(name); try FileManager.default.copyItem(at: fixture, to: copy)
            try library.install(copy, song: song)
        }
        try library.merge(Manifest(protocolVersion: 1, serverId: "duration-test", libraryName: "Test", accent: "#8CCDF3", tracks: songs, playlists: [], resumes: []))
        let player = MusicPlayer(library: library)
        for (index, song) in songs.enumerated() {
            player.play(song, ids: songs.map(\.id))
            for _ in 0..<100 {
                if abs(player.duration - 16) < 0.1 { break }
                try await Task.sleep(nanoseconds: 50_000_000)
            }
            player.pause()
            XCTAssertEqual(player.duration, 16, accuracy: 0.1)
            player.seek(index == 0 ? 8 : 100)
            XCTAssertEqual(player.position, index == 0 ? 8 : player.duration, accuracy: 0.1)
            XCTAssertFalse(player.playing)
            XCTAssertEqual(try XCTUnwrap(library.state.files[song.id]?.duration), 16, accuracy: 0.1)
        }
        database.flush()
        let restored = try database.load()
        XCTAssertEqual(try XCTUnwrap(restored.files[songs[0].id]?.duration), 16, accuracy: 0.1)
    }
    @MainActor func testImportDirectlyIntoRemotePlaylistKeepsTargetAndFilesAfterRestart() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try SnapshotDatabase(root: root), library = try Library(database: database)
        try library.setLink(Link(serverId: "import-test", host: "10.0.0.2", port: 38473, fingerprint: "a", deviceId: "phone"))
        let playlist = Playlist(id: "pc-list", name: "Desde PC", trackIds: [], revision: "server-revision")
        try library.merge(Manifest(protocolVersion: 1, serverId: "import-test", libraryName: "Test", accent: "#8CCDF3", tracks: [], playlists: [playlist], resumes: []))
        let fixtures = try ["first.flac", "second.mp3"].map { name in try XCTUnwrap(Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "Fixtures") ?? Bundle.main.url(forResource: name, withExtension: nil)) }
        let imported = await library.importFiles(fixtures, into: playlist.id)
        XCTAssertEqual(imported.count, 2)
        XCTAssertEqual(library.state.localPlaylists.first?.trackIds, imported)
        XCTAssertTrue(library.state.playlists.isEmpty)
        XCTAssertEqual(library.state.pending.first(where: { $0.kind == "playlist" })?.baseRevision, playlist.revision)
        database.flush()
        let restored = try Library(database: SnapshotDatabase(root: root))
        XCTAssertEqual(restored.state.localPlaylists.first?.trackIds, imported)
        for id in imported { XCTAssertNotNil(restored.file(id)) }
        restored.deletePlaylist(playlist.id)
        for id in imported { XCTAssertNotNil(restored.file(id)) }
    }
    @MainActor func testSharedMinutesNeverEchoAndPlaylistDeletionPreservesSongs() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let database = try SnapshotDatabase(root: root)
        let library = try Library(database: database)
        let source = try XCTUnwrap(library.listening.history.sourceId)
        let now = Date()
        library.listening.record(id: "song", seconds: 120, ending: now)
        let day = ListeningHistory.key(now.addingTimeInterval(-120))
        let remote = [ListeningEntry(source: "phone:" + source, day: day, trackId: "song", seconds: 120), ListeningEntry(source: "pc", day: day, trackId: "song", seconds: 60)]
        library.listening.merge(remote); library.listening.merge(remote)
        XCTAssertEqual(library.listening.history.combined.days.values.reduce(0) { $0 + $1.seconds }, 180, accuracy: 0.001)
        XCTAssertEqual(library.listening.outgoing.flatMap { $0.entries ?? [] }.reduce(0) { $0 + $1.seconds }, 120, accuracy: 0.001)
        let id = try XCTUnwrap(library.createLocalPlaylist(name: "Phone list", ids: ["song"]))
        let creation = try XCTUnwrap(library.state.pending.first { $0.kind == "playlist" })
        library.updateLocalPlaylist(id, name: "New edit", ids: ["song"])
        library.acknowledge(creation)
        XCTAssertEqual(library.state.localPlaylists.first?.name, "New edit")
        XCTAssertNotNil(library.state.pending.first?.baseRevision)
        library.deletePlaylist(id)
        XCTAssertTrue(library.state.localPlaylists.isEmpty)
        XCTAssertEqual(library.state.pending.first?.deleted, true)
        database.flush()
        let restored = try database.load()
        XCTAssertEqual(restored.pending.first?.deleted, true)
    }
    @MainActor func testDateOrderPersistsAndUnknownDatesStayLast() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try SnapshotDatabase(root: root)
        let library = try Library(database: db)
        let old = Song(id: "old", title: "A", artist: "Artist", album: "Album", duration: 16, format: "FLAC", modifiedAt: 1000, lyricsRevision: "")
        var new = old; new.id = "new"; new.modifiedAt = 2000
        var unknown = old; unknown.id = "unknown"; unknown.modifiedAt = nil
        let songs = [new, unknown, old]
        XCTAssertEqual(library.songOrder(for: "library"), .oldest)
        XCTAssertEqual(SongOrder.oldest.apply(songs).map(\.id), ["old", "new", "unknown"])
        XCTAssertEqual(SongOrder.newest.apply(songs).map(\.id), ["new", "old", "unknown"])
        XCTAssertEqual(SongOrder.original.apply(songs).map(\.id), songs.map(\.id))
        library.setSongOrder(.newest, for: "playlist:test")
        db.flush()
        let restored = try Library(database: SnapshotDatabase(root: root))
        XCTAssertEqual(restored.songOrder(for: "playlist:test"), .newest)
        XCTAssertEqual(restored.songOrder(for: "library"), .oldest)
    }
    @MainActor func testChangingOrderKeepsCurrentSongAndPositionAndReordersPendingQueue() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try Library(database: SnapshotDatabase(root: root))
        let fixture = try XCTUnwrap(Bundle.main.url(forResource: "first.flac", withExtension: nil, subdirectory: "Fixtures") ?? Bundle.main.url(forResource: "first.flac", withExtension: nil))
        let size = (try FileManager.default.attributesOfItem(atPath: fixture.path)[.size] as? NSNumber)?.int64Value
        let songs = (0..<3).map { index in Song(id: String(index), title: String(index), artist: "Test", album: "Test", duration: 16, format: "FLAC", modifiedAt: Double(index), fileSize: size, lyricsRevision: "") }
        try library.setLink(Link(serverId: "test-order", host: "10.0.0.2", port: 38473, fingerprint: "a", deviceId: "phone"))
        defer { DeviceKeychain.remove("test-order") }
        try library.merge(Manifest(protocolVersion: 1, serverId: "test-order", libraryName: "Test", accent: "#8CCDF3", tracks: songs, playlists: [], resumes: []))
        for song in songs {
            let copy = root.appendingPathComponent("copy-" + song.id + ".flac")
            try FileManager.default.copyItem(at: fixture, to: copy)
            try library.install(copy, song: song)
        }
        let player = MusicPlayer(library: library)
        player.play(songs[0], ids: songs.map(\.id)); player.pause(); player.seek(3)
        library.setSongOrder(.newest, for: "library")
        player.updateSearch(source: "library", ids: SongOrder.newest.apply(songs).map(\.id))
        XCTAssertEqual(player.current?.id, "0")
        XCTAssertEqual(player.position, 3)
        XCTAssertFalse(player.playing)
        XCTAssertEqual(library.state.queue?.upcoming, ["2", "1"])
        player.enqueue("1"); player.enqueue("2"); player.enqueue("1")
        XCTAssertEqual(library.state.queue?.manual, ["1", "2", "1"])
        player.next(); player.pause(); XCTAssertEqual(player.current?.id, "1")
        player.next(); player.pause(); XCTAssertEqual(player.current?.id, "2")
        player.next(); player.pause(); XCTAssertEqual(player.current?.id, "1")
        player.next(); player.pause(); XCTAssertEqual(player.current?.id, "2")
    }
    func testLyricMarkingWordsUndoAndLineShiftPreserveTiming() throws {
        var words = LyricTimingDraft("Hola mundo\nOtra vez")
        XCTAssertNil(words.encoded(words: true))
        for time in [1.0, 2, 4, 5] { words.mark(time, words: true) }
        let result = try XCTUnwrap(words.encoded(words: true))
        XCTAssertEqual(Lyrics.parse(result).flatMap(\.words).map(\.time), [1, 2, 4, 5])
        words.undoMark(); XCTAssertNil(words.encoded(words: true))
        words.mark(3, words: true); XCTAssertNil(words.encoded(words: true), "Out-of-order times must not save")
        var shifted = LyricTimingDraft(result)
        shifted.mark(2, words: false)
        XCTAssertEqual(Lyrics.parse(try XCTUnwrap(shifted.encoded(words: false)))[0].words.map(\.time), [2, 3])
    }
    func testRepeatedTimedVersesAndUntimedNewRowsAreKept() throws {
        let draft = LyricTimingDraft("[00:01][00:04]<00:01>Hola <00:02>mundo\n[00:03]<00:03>Otra")
        XCTAssertEqual(draft.rows.compactMap(\.time), [1, 3, 4])
        XCTAssertEqual(Lyrics.parse(try XCTUnwrap(draft.encoded(words: true))).count, 3)
        let mixed = LyricTimingDraft("[00:01]Ya marcada\nUna línea nueva")
        XCTAssertEqual(mixed.rows.count, 2)
        XCTAssertNil(mixed.encoded(words: false))
    }
    func testListeningSplitsMidnightAndDoesNotInventTimeFromSeeks() {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let ending = calendar.date(from: DateComponents(year: 2026, month: 1, day: 1, second: 5))!
        var history = ListeningHistory()
        history.record(id: "one", seconds: 10, ending: ending, calendar: calendar)
        XCTAssertEqual(history.days["2025-12-31"]?.seconds, 5)
        XCTAssertEqual(history.days["2026-01-01"]?.seconds, 5)
        history.record(id: "one", seconds: 90000, ending: ending, calendar: calendar)
        history.record(id: "one", seconds: -1, ending: ending, calendar: calendar)
        XCTAssertEqual(history.days.values.reduce(0) { $0 + $1.seconds }, 10)
    }
    @MainActor func testBatchedMetadataKeepsNewLocalEditsAndCoalescesSnapshots() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let db = try SnapshotDatabase(root: root), library = try Library(database: db)
        try library.setLink(Link(serverId: "metadata", host: "10.0.0.2", port: 38473, fingerprint: "a", deviceId: "phone"))
        library.beginMetadataBatch()
        for i in 0..<1500 { library.cacheLyrics(String(i), payload: LyricPayload(text: "PC", revision: "r")) }
        XCTAssertTrue(library.state.lyrics.isEmpty)
        library.editLyrics("1", text: "Editado mientras sincroniza")
        library.endMetadataBatch(); db.flush()
        XCTAssertEqual(library.state.lyrics.count, 1500)
        XCTAssertEqual(try db.load().lyrics["1"]?.text, "Editado mientras sincroniza")
    }
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
        // Exchange real playlist and listening changes through the pinned TLS server.
        let playlistID = "local-" + UUID().uuidString.lowercased()
        let create = PendingChange(id: playlistID, kind: "playlist", name: "Desde iPhone 世界", trackIds: [song.id], deleted: false)
        let created: [ChangeResult] = try await client.json("changes", body: JSONEncoder().encode(ChangeEnvelope(changes: [create])))
        XCTAssertTrue(try XCTUnwrap(created.first).applied)
        let withList: Manifest = try await client.json("manifest")
        XCTAssertEqual(withList.playlists.first { $0.id == playlistID }?.trackIds, [song.id])
        XCTAssertTrue(withList.capabilities?.contains("shared-listening-v1") == true)
        let source = UUID().uuidString.lowercased()
        let entry = ListeningValue(day: "2026-10-29", trackId: song.id, seconds: 120)
        let count = PendingChange(id: nil, kind: "listening", sourceId: source, entries: [entry])
        for _ in 0..<2 {
            let results: [ChangeResult] = try await client.json("changes", body: JSONEncoder().encode(ChangeEnvelope(changes: [count])))
            XCTAssertTrue(try XCTUnwrap(results.first).applied)
        }
        let withTime: Manifest = try await client.json("manifest")
        XCTAssertEqual(withTime.listening?.filter { $0.source == "phone:" + source }.reduce(0) { $0 + $1.seconds }, 120)
        let remove = PendingChange(id: playlistID, kind: "playlist", name: "", trackIds: [], deleted: true)
        let removed: [ChangeResult] = try await client.json("changes", body: JSONEncoder().encode(ChangeEnvelope(changes: [remove])))
        XCTAssertTrue(try XCTUnwrap(removed.first).applied)
        let afterDelete: Manifest = try await client.json("manifest")
        XCTAssertFalse(afterDelete.playlists.contains { $0.id == playlistID })
        XCTAssertTrue(afterDelete.deletedPlaylists?.contains(playlistID) == true)
        var incorrect = link; incorrect.fingerprint = String(repeating: "0", count: 64)
        do {
            let _: Manifest = try await LANClient(link: incorrect, token: try DeviceKeychain.read(link.serverId)).json("manifest")
            XCTFail("A server certificate that differs from the QR must be rejected")
        } catch { /* Expected: the TLS certificate pin differs. */ }
        XCTAssertNotNil(library.file(song.id)) // The downloaded file remains available offline.
    }

    @MainActor func testAcknowledgementPreservesEditsMadeDuringTransferAndQueuePreferences() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let database = try SnapshotDatabase(root: folder)
        let library = try Library(database: database)
        try library.setLink(Link(serverId: "pc", host: "10.0.0.2", port: 38473, fingerprint: "a", deviceId: "phone"))
        library.editLyrics("one", text: "First edit")
        let sent = try XCTUnwrap(library.state.pending.first)
        library.editLyrics("one", text: "New edit while sending")
        library.acknowledge(sent)
        XCTAssertEqual(library.state.lyrics["one"]?.text, "New edit while sending")
        XCTAssertEqual(library.state.pending.count, 1)
        XCTAssertEqual(library.state.pending.first?.baseRevision, digest(Data("First edit".utf8)))
        library.remember("one", position: 12, queue: PhoneQueue(shuffle: true, repeatAll: true, collection: "library", context: ["one", "two"], upcoming: ["two"], history: [], heard: []))
        database.flush()
        let restored = try database.load()
        XCTAssertEqual(restored.queue?.upcoming, ["two"])
        XCTAssertEqual(restored.queue?.shuffle, true)
        XCTAssertEqual(restored.queue?.repeatAll, true)
        XCTAssertEqual(restored.position, 12)
    }

    @MainActor func testLocalFLACAndMP3ImportProducesPlayableOfflineFiles() async throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let library = try Library(database: SnapshotDatabase(root: folder))
        let urls = try ["first.flac", "second.mp3"].map { name in
            try XCTUnwrap(Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "Fixtures") ?? Bundle.main.url(forResource: name, withExtension: nil), "Missing bundled fixture: " + name)
        }
        await library.importFiles(urls)
        XCTAssertEqual(library.downloaded.count, 2, library.message ?? "Both audio formats must import")
        XCTAssertEqual(Set(library.downloaded.map(\.format)), Set(["FLAC", "MP3"]))
        for song in library.downloaded {
            let file = try XCTUnwrap(library.file(song.id))
            let asset = AVURLAsset(url: file)
            let playable = try await asset.load(.isPlayable)
            XCTAssertTrue(playable, song.format + " must be playable")
            XCTAssertGreaterThan(song.duration, 1)
        }
    }

    @MainActor func testPhonePersonalizationSurvivesSyncAndRestartWithoutChangingLyrics() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let database = try SnapshotDatabase(root: folder)
        let library = try Library(database: database)
        try library.setLink(Link(serverId: "pc", host: "10.0.0.2", port: 38473, fingerprint: "a", deviceId: "phone"))
        var preferences = PhoneAppearance()
        preferences.profileName = "Mi iPhone"; preferences.accent = "#BDA9FA"; preferences.hud = "large"; preferences.lyricSize = 38; preferences.backdrop = "graphite"
        library.updateAppearance(preferences)
        library.editLyrics("one", text: "[00:01]Mi letra local")
        let song = Song(id: "one", title: "Canción", artist: "Artista", album: "Álbum", duration: 16, format: "FLAC", lyricsRevision: digest(Data()))
        try library.merge(Manifest(protocolVersion: 1, serverId: "pc", libraryName: "Nombre de la PC", accent: "#FF0000", tracks: [song], playlists: [], resumes: []))
        XCTAssertEqual(library.displayName, "Mi iPhone")
        XCTAssertEqual(library.effectiveAccent, "#BDA9FA")
        XCTAssertEqual(library.state.lyrics["one"]?.text, "[00:01]Mi letra local")
        database.flush()
        let restored = try Library(database: database)
        XCTAssertEqual(restored.phoneAppearance, preferences)
        XCTAssertEqual(restored.phoneAppearance.lyricSize, 38)
        var following = restored.phoneAppearance; following.useComputerAccent = true; restored.updateAppearance(following)
        XCTAssertEqual(restored.effectiveAccent, "#FF0000")
        restored.resetAppearance()
        XCTAssertEqual(restored.effectiveAccent, "#8CCDF3")
        XCTAssertEqual(restored.displayName, "Mi iPhone")
        XCTAssertEqual(restored.state.pending.count, 1)
    }
    @MainActor func testOldSnapshotsOpenWithoutPhoneAppearanceAndKeepQueue() throws {
        var original = LibraryState()
        original.currentId = "one"; original.position = 42
        original.queue = PhoneQueue(collection: "library", context: ["one", "two"], upcoming: ["two"], history: [], heard: [])
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        json.removeValue(forKey: "phoneAppearance")
        let restored = try JSONDecoder().decode(LibraryState.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertNil(restored.phoneAppearance)
        XCTAssertEqual(restored.position, 42)
        XCTAssertEqual(restored.queue?.upcoming, ["two"])
    }
    @MainActor func testArtworkAndAvatarAreStandardRGBThumbnailsAtActualPixelSize() throws {
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        let original = UIGraphicsImageRenderer(size: CGSize(width: 1600, height: 900), format: format).image { context in
            UIColor.systemTeal.setFill(); context.fill(CGRect(x: 0, y: 0, width: 1600, height: 900))
        }
        let thumbnail = PhoneImages.thumbnail(original, maxSide: 512)
        XCTAssertEqual(thumbnail.cgImage?.width, 512)
        XCTAssertLessThanOrEqual(thumbnail.cgImage?.height ?? 0, 512)
        XCTAssertEqual(thumbnail.cgImage?.bitsPerComponent, 8)
        XCTAssertEqual(thumbnail.scale, 1)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: folder) }
        let database = try SnapshotDatabase(root: folder)
        let library = try Library(database: database)
        try library.setAvatar(XCTUnwrap(original.pngData()))
        XCTAssertTrue(library.phoneAppearance.hasAvatar)
        XCTAssertEqual(library.avatar?.cgImage?.width, 256)
        XCTAssertEqual(library.avatar?.cgImage?.height, 256)
        database.flush()
        XCTAssertTrue(try database.load().phoneAppearance?.hasAvatar == true)
        try library.setAvatar(nil)
        XCTAssertNil(library.avatar)
        XCTAssertFalse(library.phoneAppearance.hasAvatar)
    }

}
