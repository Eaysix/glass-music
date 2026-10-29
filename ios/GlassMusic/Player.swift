import Foundation
import AVFoundation
import MediaPlayer
import UIKit

@MainActor final class MusicPlayer: ObservableObject {
    @Published private(set) var current: Song?
    @Published private(set) var position: Double = 0
    @Published private(set) var playing = false
    @Published var shuffle = false
    @Published var repeatAll = false
    private let library: Library
    private let audio = AVPlayer()
    private var detailed = false
    private var itemStatus: NSKeyValueObservation?
    private var observer: Any?
    private var tokens: [NSObjectProtocol] = []
    private var remoteTargets: [(MPRemoteCommand, Any)] = []
    private var context: [String] = []
    private var collection: String = "library"
    @Published private(set) var manualQueue: [String] = []
    @Published private(set) var automaticQueue: [String] = []
    private var currentWasManual = false
    private var historyManual: [Bool] = []
    private var upcoming: [String] = []
    private var heard: Set<String> = []
    private var history: [String] = []
    private var listenedPosition = 0.0
    private var listenedUptime = ProcessInfo.processInfo.systemUptime
    private var lastPersist: Double = 0
    private var interruptedPlaying = false
    init(library: Library) {
        self.library = library
        if let queue = library.state.queue { shuffle = queue.shuffle ?? false; repeatAll = queue.repeatAll ?? false; collection = queue.collection; context = queue.context; upcoming = queue.upcoming; automaticQueue = queue.upcoming; history = queue.history; heard = queue.heard; manualQueue = queue.manual ?? []; currentWasManual = queue.currentWasManual ?? false; historyManual = queue.historyManual ?? queue.history.map { _ in false } }
        if let id = library.state.currentId { current = library.state.songs.first { $0.id == id }; position = library.state.position }
        let center = NotificationCenter.default
        tokens.append(center.addObserver(forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] notification in
            Task { @MainActor in guard let self, notification.object as? AVPlayerItem === self.audio.currentItem else { return }; self.next() }
        })
        tokens.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] notification in
            let reason = (notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? NSNumber)?.uintValue
            if reason == AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { Task { @MainActor in self?.pause() } }
        })
        tokens.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] notification in
            let type = (notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? NSNumber)?.uintValue
            let options = (notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? NSNumber)?.uintValue ?? 0
            Task { @MainActor in
                guard let self else { return }
                if type == AVAudioSession.InterruptionType.began.rawValue { self.interruptedPlaying = self.playing; self.pause() }
                else if type == AVAudioSession.InterruptionType.ended.rawValue {
                    if self.interruptedPlaying && AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) { self.resume() }
                    self.interruptedPlaying = false
                }
            }
        })
        library.catalogChanged = { [weak self] in self?.reconcile() }
        setupRemote()
    }
    private func activate() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [])
        try session.setActive(true)
    }
    func play(_ song: Song, ids: [String], source: String = "library", from: Double = 0) {
        guard library.file(song.id) != nil else { library.message = "Descarga esta canción para escucharla sin conexión."; return }
        let byId = Dictionary(uniqueKeysWithValues: library.state.songs.map { ($0.id, $0) })
        let available = library.songOrder(for: source).apply(ids.compactMap { byId[$0] }).map(\.id).filter { library.isDownloaded($0) }
        context = available; collection = source; heard = []; history = []; historyManual = []; currentWasManual = false
        if shuffle { upcoming = available.filter { $0 != song.id }.shuffled() }
        else { upcoming = Array(available.dropFirst((available.firstIndex(of: song.id) ?? -1) + 1)) }
        start(song, from: from)
    }
    private func start(_ song: Song, from: Double = 0) {
        sampleListening(); library.listening.flush()
        guard let file = library.file(song.id) else { library.message = "Descarga esta canción para escucharla sin conexión."; return }
        do {
            try activate()
            let item = AVPlayerItem(url: file)
            current = song; audio.replaceCurrentItem(with: item)
            itemStatus = item.observe(\.status, options: [.new]) { [weak self] item, _ in
                guard item.status == .failed else { return }
                Task { @MainActor in self?.pause(); self?.library.message = item.error?.localizedDescription ?? "No se pudo reproducir este archivo." }
            }
            position = max(0, min(from, song.duration > 0 ? song.duration : from))
            audio.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            audio.play(); playing = true; lastPersist = position
            observeClock(); persist(); nowPlaying()
        } catch { library.message = error.localizedDescription; pause() }
    }
    func resume() {
        guard let song = current else { if let first = library.downloaded.first { play(first, ids: library.downloaded.map(\.id)) }; return }
        if audio.currentItem == nil { if context.isEmpty { context = library.songOrder(for: collection).apply(library.downloaded).map(\.id) }; start(song, from: song.duration > 0 && position >= song.duration - 0.5 ? 0 : position); return }
        if song.duration > 0 && position >= song.duration - 0.5 { seek(0) }
        do { try activate(); audio.play(); playing = true; observeClock(); nowPlaying() }
        catch { library.message = error.localizedDescription }
    }
    func pause() {
        sampleListening(); library.listening.flush()
        audio.pause(); playing = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if let observer { audio.removeTimeObserver(observer); self.observer = nil }
        persist(); nowPlaying()
    }
    func toggle() { playing ? pause() : resume() }
    func toggleShuffle() {
        shuffle.toggle()
        if shuffle { upcoming.shuffle() }
        else { let eligible = Set(upcoming); upcoming = context.filter { eligible.contains($0) } }
        persist()
    }
    func toggleRepeat() { repeatAll.toggle(); persist() }
    func unload(_ id: String) { if current?.id == id { pause(); itemStatus = nil; audio.replaceCurrentItem(with: nil) } }
    func seek(_ seconds: Double) {
        sampleListening()
        guard let current else { return }
        position = max(0, min(seconds.isFinite ? seconds : 0, current.duration))
        audio.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        persist(); nowPlaying()
    }
    func enqueue(_ id: String) {
        guard library.file(id) != nil else { library.message = "Descarga esta canción antes de añadirla a la cola."; return }
        manualQueue.append(id); persist()
    }
    func removeManual(at offsets: IndexSet) { for index in offsets.sorted(by: >) where manualQueue.indices.contains(index) { manualQueue.remove(at: index) }; persist() }
    func next() {
        if let current { if !currentWasManual { heard.insert(current.id) }; history.append(current.id); historyManual.append(currentWasManual) }
        while !manualQueue.isEmpty {
            let id = manualQueue.removeFirst()
            if let song = library.state.songs.first(where: { $0.id == id }), library.file(id) != nil { currentWasManual = true; start(song); return }
        }
        currentWasManual = false
        if upcoming.isEmpty && repeatAll { heard = []; upcoming = context.filter { library.isDownloaded($0) }; if shuffle { upcoming.shuffle() } }
        while !upcoming.isEmpty {
            let id = upcoming.removeFirst()
            if let song = library.state.songs.first(where: { $0.id == id }), library.file(id) != nil { start(song); return }
        }
        pause(); if let current { position = current.duration; persist() }
    }
    func previous() {
        if position > 3 || history.isEmpty { seek(0); return }
        if let current { if currentWasManual { manualQueue.insert(current.id, at: 0) } else { upcoming.insert(current.id, at: 0) } }
        let id = history.removeLast(); heard.remove(id)
        currentWasManual = historyManual.popLast() ?? false
        if let song = library.state.songs.first(where: { $0.id == id }) { start(song) }
    }
    func updateSearch(source: String, ids: [String]) { if collection == source { reconcile(ids: ids) } }
    private func reconcile(ids provided: [String]? = nil) {
        let requested: [String]
        if let supplied = provided { requested = supplied }
        else if collection.hasPrefix("playlist:") {
            let playlists: [Playlist] = library.state.playlists + library.state.localPlaylists
            let playlist: Playlist? = playlists.first(where: { "playlist:" + $0.id == collection })
            requested = playlist?.trackIds ?? []
        } else if collection == "favorites" { requested = library.state.songs.filter(\.favorite).map(\.id) }
        else { requested = library.state.songs.map(\.id) }
        let byId = Dictionary(uniqueKeysWithValues: library.state.songs.map { ($0.id, $0) })
        let ids = library.songOrder(for: collection).apply(requested.compactMap { byId[$0] }).map(\.id).filter { library.isDownloaded($0) }
        let old = Set(context); context = ids
        let eligible = Set(upcoming)
        let additions = ids.filter { !old.contains($0) && !heard.contains($0) && $0 != current?.id && library.isDownloaded($0) }
        if shuffle { upcoming = upcoming.filter { ids.contains($0) && library.isDownloaded($0) } + additions.shuffled() }
        else { upcoming = ids.filter { (eligible.contains($0) || additions.contains($0)) && library.isDownloaded($0) } }
        if let current, let refreshed = library.state.songs.first(where: { $0.id == current.id }) { self.current = refreshed }
        persist()
    }
    func persist() { automaticQueue = upcoming; library.remember(current?.id, position: position, queue: PhoneQueue(shuffle: shuffle, repeatAll: repeatAll, collection: collection, context: context, upcoming: upcoming, history: Array(history.suffix(200)), heard: heard, manual: manualQueue, currentWasManual: currentWasManual, historyManual: Array(historyManual.suffix(200)))) }
    func detailedLyrics(_ visible: Bool) { detailed = visible; if playing { observeClock() } }
    private func sampleListening() {
        let uptime = ProcessInfo.processInfo.systemUptime
        let actual = audio.currentTime().seconds
        let elapsed = uptime - listenedUptime, delta = actual - listenedPosition
        if playing, audio.timeControlStatus == .playing, let id = current?.id, elapsed > 0, elapsed <= 86400, delta > 0, abs(delta - elapsed) < 2 {
            library.listening.record(id: id, seconds: min(delta, elapsed))
        }
        listenedUptime = uptime; listenedPosition = actual.isFinite ? actual : 0
    }
    private func observeClock() {
        listenedUptime = ProcessInfo.processInfo.systemUptime; listenedPosition = audio.currentTime().seconds

        if let observer { audio.removeTimeObserver(observer) }
        observer = audio.addPeriodicTimeObserver(forInterval: CMTime(seconds: detailed ? 0.1 : 1, preferredTimescale: 600), queue: .main) { [weak self] time in
            Task { @MainActor in guard let self, time.seconds.isFinite else { return }; self.sampleListening(); self.position = max(0, time.seconds)
                if abs(self.position - self.lastPersist) >= 10 { self.lastPersist = self.position; self.persist(); self.nowPlaying() }
            }
        }
    }
    private func nowPlaying() {
        guard let current else { MPNowPlayingInfoCenter.default().nowPlayingInfo = nil; return }
        var info: [String: Any] = [MPMediaItemPropertyTitle: current.title, MPMediaItemPropertyArtist: current.artist, MPMediaItemPropertyAlbumTitle: current.album, MPMediaItemPropertyPlaybackDuration: current.duration, MPNowPlayingInfoPropertyElapsedPlaybackTime: position, MPNowPlayingInfoPropertyPlaybackRate: playing ? 1.0 : 0.0]
        if let image = library.cover(current.id) { info[MPMediaItemPropertyArtwork] = MPMediaItemArtwork(boundsSize: image.size) { _ in image } }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }
    private func setupRemote() {
        let center = MPRemoteCommandCenter.shared()
        func add(_ command: MPRemoteCommand, action: @escaping () -> Void) {
            command.isEnabled = true
            let target = command.addTarget { _ in Task { @MainActor in action() }; return .success }
            remoteTargets.append((command, target))
        }
        add(center.playCommand) { [weak self] in self?.resume() }; add(center.pauseCommand) { [weak self] in self?.pause() }
        add(center.togglePlayPauseCommand) { [weak self] in self?.toggle() }
        add(center.nextTrackCommand) { [weak self] in self?.next() }; add(center.previousTrackCommand) { [weak self] in self?.previous() }
        let target = center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            Task { @MainActor in self?.seek(event.positionTime) }; return .success
        }
        remoteTargets.append((center.changePlaybackPositionCommand, target))
    }
}
