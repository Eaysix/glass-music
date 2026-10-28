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
    private var upcoming: [String] = []
    private var heard: Set<String> = []
    private var history: [String] = []
    private var lastPersist: Double = 0
    private var interruptedPlaying = false
    init(library: Library) {
        self.library = library
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
                else if self.interruptedPlaying && AVAudioSession.InterruptionOptions(rawValue: options).contains(.shouldResume) { self.resume() }
                self.interruptedPlaying = false
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
        context = ids; collection = source; heard = []; history = []
        let available = ids.filter { library.file($0) != nil }
        if shuffle { upcoming = available.filter { $0 != song.id }.shuffled() }
        else { upcoming = Array(available.dropFirst((available.firstIndex(of: song.id) ?? -1) + 1)) }
        start(song, from: from)
    }
    private func start(_ song: Song, from: Double = 0) {
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
        if audio.currentItem == nil { play(song, ids: library.downloaded.map(\.id), from: position); return }
        do { try activate(); audio.play(); playing = true; observeClock(); nowPlaying() }
        catch { library.message = error.localizedDescription }
    }
    func pause() {
        audio.pause(); playing = false
        if let observer { audio.removeTimeObserver(observer); self.observer = nil }
        persist(); nowPlaying()
    }
    func toggle() { playing ? pause() : resume() }
    func seek(_ seconds: Double) {
        guard let current else { return }
        position = max(0, min(seconds.isFinite ? seconds : 0, current.duration))
        audio.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
        persist(); nowPlaying()
    }
    func next() {
        if let current { heard.insert(current.id); history.append(current.id) }
        if upcoming.isEmpty && repeatAll { heard = []; upcoming = context.filter { library.file($0) != nil }; if shuffle { upcoming.shuffle() } }
        while !upcoming.isEmpty {
            let id = upcoming.removeFirst()
            if let song = library.state.songs.first(where: { $0.id == id }), library.file(id) != nil { start(song); return }
        }
        pause(); if let current { position = current.duration; persist() }
    }
    func previous() {
        if position > 3 || history.isEmpty { seek(0); return }
        if let current { upcoming.insert(current.id, at: 0) }
        let id = history.removeLast(); heard.remove(id)
        if let song = library.state.songs.first(where: { $0.id == id }) { start(song) }
    }
    func updateSearch(source: String, ids: [String]) { if collection == source { reconcile(ids: ids) } }
    private func reconcile(ids provided: [String]? = nil) {
        let ids: [String]
        if let supplied = provided { ids = supplied }
        else if collection.hasPrefix("playlist:") {
            let playlists: [Playlist] = library.state.playlists + library.state.localPlaylists
            let playlist: Playlist? = playlists.first(where: { "playlist:" + $0.id == collection })
            ids = playlist?.trackIds ?? []
        } else { ids = library.state.songs.map(\.id) }
        let old = Set(context); context = ids
        let eligible = Set(upcoming)
        let additions = ids.filter { !old.contains($0) && !heard.contains($0) && $0 != current?.id && library.file($0) != nil }
        if shuffle { upcoming = upcoming.filter { ids.contains($0) && library.file($0) != nil } + additions.shuffled() }
        else { upcoming = ids.filter { (eligible.contains($0) || additions.contains($0)) && library.file($0) != nil } }
        if let current, let refreshed = library.state.songs.first(where: { $0.id == current.id }) { self.current = refreshed }
    }
    func persist() { library.remember(current?.id, position: position) }
    func detailedLyrics(_ visible: Bool) { detailed = visible; if playing { observeClock() } }
    private func observeClock() {
        if let observer { audio.removeTimeObserver(observer) }
        observer = audio.addPeriodicTimeObserver(forInterval: CMTime(seconds: detailed ? 0.1 : 1, preferredTimescale: 600), queue: .main) { [weak self] time in
            Task { @MainActor in guard let self, time.seconds.isFinite else { return }; self.position = max(0, time.seconds)
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
