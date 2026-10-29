import SwiftUI
import UniformTypeIdentifiers

struct RootView: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var sync: SyncManager
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let player: MusicPlayer
    @Namespace private var navigationMotion
    @State private var tab = 0
    @State private var nowPlaying = false
    @State private var pairing = false
    @State private var imported = false
    @State private var incomingCode = ""
    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $tab) {
                NavigationStack { HomeView(player: player, link: { pairing = true }, importFiles: { imported = true }, settings: { tab = 4 }) }.tabItem { Label("Inicio", systemImage: "house") }.tag(0)
                NavigationStack { SongList(player: player, title: "Tu música", ids: nil, downloadedOnly: false) }.tabItem { Label("Biblioteca", systemImage: "music.note.list") }.tag(1)
                NavigationStack { SongList(player: player, title: "Descargadas", ids: nil, downloadedOnly: true, source: "downloads") }.tabItem { Label("Descargas", systemImage: "arrow.down.circle") }.tag(2)
                NavigationStack { SyncView(player: player, pair: { pairing = true }).glassScreen() }.tabItem { Label("Sincronizar", systemImage: "arrow.triangle.2.circlepath") }.tag(3)
                NavigationStack { PhoneSettingsView() }.tabItem { Label("Ajustes", systemImage: "slider.horizontal.3") }.tag(4)
            }
            .toolbar(.hidden, for: .tabBar)
            .background { GlassBackdrop() }
            bottomDock
        }
        .background { GlassBackdrop() }
        .tint(library.tint).preferredColorScheme(.dark)
        .sheet(isPresented: $pairing) { PairView(initial: incomingCode).environmentObject(library).environmentObject(sync).tint(library.tint) }
        .fullScreenCover(isPresented: $nowPlaying) { NowPlayingView(player: player).environmentObject(library).tint(library.tint) }
        .fileImporter(isPresented: $imported, allowedContentTypes: [UTType(filenameExtension: "flac") ?? .audio, .mp3], allowsMultipleSelection: true) { result in
            switch result { case .success(let urls): Task { await library.importFiles(urls) }; case .failure(let error): library.message = error.localizedDescription }
        }
        .alert("Glass Music", isPresented: Binding(get: { library.message != nil }, set: { if !$0 { library.message = nil } })) { Button("Entendido") { library.message = nil } } message: { Text(library.message ?? "") }
        .onOpenURL { url in if url.scheme == "glassmusic" { incomingCode = url.absoluteString; pairing = true } }
    }
    @ViewBuilder private var bottomDock: some View {
        if #available(iOS 26, *) { GlassEffectContainer(spacing: 8) { dockContent } }
        else { dockContent }
    }
    private var dockContent: some View {
        VStack(spacing: 8) {
            MiniPlayer(player: player, open: { nowPlaying = true })
            navigation
        }.padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 5).frame(maxWidth: 620)
            .animation(library.phoneAppearance.animations && !reduceMotion ? .spring(response: 0.4, dampingFraction: 0.85) : nil, value: player.current != nil)
    }
    private var navigation: some View {
        HStack(spacing: 0) {
            navigationButton(0, "Inicio", "house", "home")
            navigationButton(1, "Biblioteca", "music.note.list", "library")
            navigationButton(2, "Descargas", "arrow.down.circle", "downloads")
            navigationButton(3, "Sincronizar", "arrow.triangle.2.circlepath", "sync")
            navigationButton(4, "Ajustes", "slider.horizontal.3", "settings")
        }.padding(5).glassSurface(radius: 27, chrome: true)
    }
    private func navigationButton(_ value: Int, _ title: String, _ symbol: String, _ identifier: String) -> some View {
        Button {
            withAnimation(library.phoneAppearance.animations && !reduceMotion ? .easeOut(duration: 0.2) : nil) { tab = value }
        } label: {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 19, weight: tab == value ? .semibold : .regular))
                Text(title).font(.system(size: 9.5, weight: tab == value ? .semibold : .medium)).lineLimit(1).minimumScaleFactor(0.75)
            }.foregroundStyle(tab == value ? library.tint : Color.white.opacity(0.55))
                .frame(maxWidth: .infinity).frame(height: 48)
                .background { if tab == value { RoundedRectangle(cornerRadius: 21, style: .continuous).fill(library.tint.opacity(0.11)).matchedGeometryEffect(id: "selected-navigation", in: navigationMotion) } }
                .contentShape(Rectangle())
        }.buttonStyle(GlassPressStyle()).accessibilityLabel(title).accessibilityIdentifier("nav-" + identifier)
            .accessibilityAddTraits(tab == value ? .isSelected : [])
    }
}
struct Artwork: View {
    @EnvironmentObject private var library: Library
    let id: String
    var size: CGFloat = 56
    var body: some View {
        Group { if let image = library.cover(id) { Image(uiImage: image).resizable().scaledToFill() }
            else { ZStack { library.tint.opacity(0.12); Image(systemName: "waveform").font(.system(size: size * 0.32)).foregroundStyle(library.tint) } }
        }.frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: size * 0.18))
    }
}
struct HomeView: View {
    @EnvironmentObject private var library: Library
    let player: MusicPlayer
    let link: () -> Void
    let importFiles: () -> Void
    let settings: () -> Void
    @State private var stats = false
    @State private var create = false
    private var lists: [Playlist] { library.state.playlists + library.state.localPlaylists }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                HStack(spacing: 9) {
                    Image(systemName: "waveform").font(.title2).foregroundStyle(library.tint)
                    Text("glass").bold() + Text("music").foregroundColor(.secondary)
                    Spacer()
                    Button(action: settings) { ProfileAvatar(size: 38).frame(width: 44, height: 44) }.buttonStyle(GlassPressStyle()).accessibilityLabel("Personalizar iPhone")
                }.font(.title3).padding(.top, 4)
                VStack(alignment: .leading, spacing: 10) { Text("Tu música.\nContigo.").font(.system(size: 36 * library.phoneAppearance.hudScale, weight: .bold, design: .rounded)); Text("\(library.displayName) · \(library.downloaded.count) canciones sin conexión").font(.subheadline).foregroundStyle(.secondary) }
                if library.state.link == nil {
                    VStack(alignment: .leading, spacing: 16) {
                        Label("Tu colección, en tu bolsillo", systemImage: "iphone.and.arrow.forward").font(.headline)
                        Text("Conecta tu PC para traer playlists, portadas y las letras que ya editaste.").foregroundStyle(.secondary)
                        Button(action: link) { Label("Vincular mi PC", systemImage: "qrcode.viewfinder").frame(maxWidth: .infinity) }.buttonStyle(.borderedProminent)
                        Button(action: importFiles) { Label("Importar desde Archivos", systemImage: "folder") }.buttonStyle(.bordered)
                    }.glassCard()
                }
                if let song = library.state.songs.first(where: { $0.id == library.state.currentId }), library.file(song.id) != nil {
                    Button { player.play(song, ids: library.downloaded.map(\.id), from: library.state.position) } label: {
                        HStack { Artwork(id: song.id); VStack(alignment: .leading, spacing: 5) { Text("SEGUIR ESCUCHANDO").font(.caption2).tracking(1.5).foregroundStyle(.secondary); Text(song.title).font(.headline).foregroundStyle(.primary).lineLimit(1); Text(clock(library.state.position)).font(.caption).foregroundStyle(.secondary) }; Spacer(); Image(systemName: "play.fill").font(.title2) }.glassCard()
                    }.buttonStyle(.plain)
                }
                if let resume = library.state.resumes.first(where: { $0.deviceId == "pc" }), let song = library.state.songs.first(where: { $0.id == resume.trackId }) {
                    VStack(alignment: .leading, spacing: 12) { Label("En tu PC", systemImage: "desktopcomputer").font(.headline); Text(song.title).font(.title3.bold()); Text("Continúa desde \(clock(resume.position))").foregroundStyle(.secondary)
                        if library.file(song.id) != nil { Button("Continuar aquí") { player.play(song, ids: library.downloaded.map(\.id), from: resume.position) }.buttonStyle(.bordered) }
                        else { Text("Descarga la canción desde Biblioteca para continuar sin conexión.").font(.caption).foregroundStyle(.secondary) }
                    }.glassCard()
                }
                Button { stats = true } label: { Label("Tu música en números", systemImage: "chart.bar.fill").frame(maxWidth: .infinity).padding(.vertical, 10) }.glassSurface(radius: 22, chrome: true).buttonStyle(GlassPressStyle())
                HStack { Text("Tus playlists").font(.title2.bold()); Spacer(); Button { create = true } label: { Image(systemName: "plus.circle") }.accessibilityLabel("Crear playlist local") }
                if lists.isEmpty { Text("Tus playlists de la PC aparecerán aquí al sincronizar. También puedes crear una lista local.").foregroundStyle(.secondary).padding(.vertical) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140 * library.phoneAppearance.hudScale), spacing: 16)], spacing: 22) {
                    ForEach(lists) { playlist in NavigationLink { SongList(player: player, title: playlist.name, ids: playlist.trackIds, downloadedOnly: false, source: "playlist:" + playlist.id) } label: {
                        VStack(alignment: .leading, spacing: 10) { GeometryReader { geometry in Artwork(id: "playlist:" + playlist.id, size: geometry.size.width) }.aspectRatio(1, contentMode: .fit); Text(playlist.name).font(.headline).lineLimit(1); Text("\(playlist.trackIds.count) canciones\(playlist.revision == "local" ? " · En este iPhone" : "")").font(.caption).foregroundStyle(.secondary) }
                    }.buttonStyle(.plain) }
                }
                Button(action: importFiles) { Label("Añadir música local", systemImage: "plus").frame(maxWidth: .infinity).padding(.vertical, 6) }.buttonStyle(.bordered).padding(.vertical).accessibilityIdentifier("import-local-music")
            }.padding(22).padding(.bottom, 20)
        }.glassScreen().navigationBarTitleDisplayMode(.inline).toolbar(.hidden, for: .tabBar).toolbar(.hidden, for: .navigationBar)
        .sheet(isPresented: $stats) { ListeningStatsView().environmentObject(library) }
        .sheet(isPresented: $create) { LocalPlaylistView().environmentObject(library) }
    }
}
struct SongList: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var sync: SyncManager
    let player: MusicPlayer
    let title: String
    let ids: [String]?
    let downloadedOnly: Bool
    var source = "library"
    @State private var showQueue = false
    @State private var editPlaylist = false
    @State private var search = ""
    private var songs: [Song] {
        let list: [Song]
        let resolvedIds = source.hasPrefix("playlist:") ? (library.state.playlists + library.state.localPlaylists).first(where: { "playlist:" + $0.id == source })?.trackIds ?? ids : ids
        if let ids = resolvedIds { let map = Dictionary(uniqueKeysWithValues: library.state.songs.map { ($0.id, $0) }); list = ids.compactMap { map[$0] } }
        else { list = library.state.songs }
        return library.songOrder(for: source).apply(list).filter { (!downloadedOnly || library.isDownloaded($0.id)) && (search.isEmpty || "\($0.title) \($0.artist) \($0.album)".localizedCaseInsensitiveContains(search)) }
    }
    var body: some View {
        let visible = songs
        let context = visible.map(\.id)
        return List {
            Section {
                Picker("Orden de canciones", selection: Binding(get: { library.songOrder(for: source) }, set: { library.setSongOrder($0, for: source) })) {
                    ForEach(SongOrder.allCases) { order in Text(order.label).tag(order) }
                }.accessibilityIdentifier("song-order").listRowBackground(Color.white.opacity(0.035))
            }
            if !songs.isEmpty {
                Section {
                    HStack { Button { if let first = songs.first(where: { library.file($0.id) != nil }) { player.play(first, ids: songs.map(\.id), source: source) } } label: { Label("Reproducir", systemImage: "play.fill") }.buttonStyle(.borderedProminent)
                        Spacer(); if !downloadedOnly, library.state.link != nil { Button { sync.download(songs.map(\.id)) } label: { Image(systemName: "arrow.down.circle") }.disabled(sync.busy).accessibilityLabel("Descargar esta lista") }
                    }.listRowBackground(Color.clear)
                }
            }
            ForEach(visible) { song in SongRow(song: song, player: player, context: context, source: source) }.listRowBackground(Color.white.opacity(0.035))
            if songs.isEmpty { ContentUnavailableView(search.isEmpty ? "Tu música aparecerá aquí" : "Sin resultados", systemImage: "music.note", description: Text("Sincroniza tu PC o importa archivos FLAC y MP3." )).listRowBackground(Color.clear) }
        }.glassScreen().toolbar(.hidden, for: .tabBar).listStyle(.insetGrouped).navigationTitle(title).searchable(text: $search, prompt: "Canciones, artistas, álbumes")
        .sheet(isPresented: $showQueue) { PhoneQueueView(player: player).environmentObject(library) }
        .toolbar { ToolbarItem(placement: .topBarTrailing) { Button { showQueue = true } label: { Image(systemName: "list.bullet") }.accessibilityLabel("Cola") }; if source.hasPrefix("playlist:local-") { ToolbarItem(placement: .topBarTrailing) { Button { editPlaylist = true } label: { Image(systemName: "pencil") }.accessibilityLabel("Editar playlist") } } }
        .sheet(isPresented: $editPlaylist) { LocalPlaylistView(playlistID: String(source.dropFirst("playlist:".count))).environmentObject(library) }
        .onChange(of: songs.map(\.id)) { _, ids in player.updateSearch(source: source, ids: ids) }
    }
}
struct SongRow: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var sync: SyncManager
    let song: Song
    let player: MusicPlayer
    let context: [String]
    let source: String
    @State private var editor = false
    @State private var removing = false
    var body: some View {
        HStack(spacing: 12) {
            Button { player.play(song, ids: context, source: source) } label: { HStack(spacing: 12) { Artwork(id: song.id, size: 44 * library.phoneAppearance.hudScale); VStack(alignment: .leading, spacing: 5) { Text(song.title).font(.system(size: 15 * library.phoneAppearance.hudScale, weight: .semibold)).foregroundStyle(.primary).lineLimit(1); Text(song.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1) } }.contentShape(Rectangle()) }.buttonStyle(.plain).accessibilityIdentifier("play-song-\(song.id)")
            Spacer(minLength: 0)
            if library.file(song.id) == nil { Button { sync.download([song.id]) } label: { Image(systemName: "arrow.down.circle") }.disabled(sync.busy || library.state.localIds.contains(song.id)).accessibilityLabel("Descargar \(song.title)") }
            else { Image(systemName: "checkmark.circle.fill").font(.caption).foregroundStyle(.secondary).accessibilityLabel("Disponible sin conexión") }
            Menu {
                Button("Añadir a la cola", systemImage: "text.badge.plus") { player.enqueue(song.id) }.disabled(!library.isDownloaded(song.id))
                Button(song.favorite ? "Quitar de Me gusta" : "Me gusta", systemImage: song.favorite ? "heart.slash" : "heart") { library.favorite(song.id) }
                Button("Editar letra", systemImage: "text.quote") { editor = true }.disabled(library.state.lyrics[song.id] == nil && !library.state.localIds.contains(song.id) && song.lyricsRevision != digest(Data()))
                if library.file(song.id) != nil { Button("Quitar descarga del iPhone", systemImage: "trash", role: .destructive) { removing = true } }
            } label: { Image(systemName: "ellipsis").padding(.vertical, 10) }.accessibilityLabel("Opciones de \(song.title)")
        }.padding(.vertical, 5)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            Button { player.enqueue(song.id) } label: { Label("Añadir a la cola", systemImage: "text.badge.plus") }.tint(library.tint).disabled(!library.isDownloaded(song.id))
        }
        .sheet(isPresented: $editor) { LyricsEditorView(song: song, player: player).environmentObject(library) }
        .confirmationDialog("¿Quitar la descarga de este iPhone?", isPresented: $removing, titleVisibility: .visible) { Button("Quitar descarga", role: .destructive) { player.unload(song.id); library.removeDownload(song.id) } } message: { Text("La canción y su letra se conservan en la PC.") }
    }
}
struct MiniPlayer: View {
    @EnvironmentObject private var library: Library
    @ObservedObject var player: MusicPlayer
    let open: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var motion: Animation? { library.phoneAppearance.animations && !reduceMotion ? .spring(response: 0.36, dampingFraction: 0.82) : nil }
    var body: some View {
        if let song = player.current {
            VStack(spacing: 7) {
                HStack(spacing: 8) {
                    Button(action: open) {
                        HStack(spacing: 10) {
                            Artwork(id: song.id, size: 40 * library.phoneAppearance.hudScale).id(song.id).transition(.opacity.combined(with: .scale(scale: 0.85)))
                            VStack(alignment: .leading, spacing: 4) {
                                Text(song.title).font(.system(size: 14 * library.phoneAppearance.hudScale, weight: .semibold)).foregroundStyle(.primary).lineLimit(1)
                                if library.phoneAppearance.hud != "compact" { Text(song.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                            }.frame(maxWidth: .infinity, alignment: .leading)
                        }.contentShape(Rectangle())
                    }.buttonStyle(GlassPressStyle()).accessibilityLabel("Abrir reproductor")
                    Button { player.toggle() } label: { Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.system(size: 20, weight: .semibold)).frame(width: 44, height: 44) }.accessibilityLabel(player.playing ? "Pausar" : "Reproducir").accessibilityIdentifier("mini-play-pause")
                    Button { player.next() } label: { Image(systemName: "forward.end.fill").font(.system(size: 19)).frame(width: 44, height: 44) }.accessibilityLabel("Siguiente")
                }.foregroundStyle(library.tint)
                GeometryReader { geometry in
                    Capsule().fill(.white.opacity(0.1))
                    Capsule().fill(library.tint.opacity(0.8)).frame(width: geometry.size.width * min(1, max(0, player.position / max(1, song.duration))))
                }.frame(height: 2).accessibilityHidden(true)
            }.animation(motion, value: song.id).animation(motion, value: player.playing).padding(.horizontal, 12).padding(.top, 9).padding(.bottom, 7).glassSurface(radius: 24, chrome: true)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .accessibilityElement(children: .contain)
        }
    }
}
