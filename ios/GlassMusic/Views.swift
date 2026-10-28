import SwiftUI
import UniformTypeIdentifiers

struct RootView: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var sync: SyncManager
    let player: MusicPlayer
    @State private var tab = 0
    @State private var nowPlaying = false
    @State private var pairing = false
    @State private var imported = false
    @State private var incomingCode = ""
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.07, green: 0.10, blue: 0.16), Color(red: 0.035, green: 0.045, blue: 0.075)], startPoint: .topLeading, endPoint: .bottomTrailing).ignoresSafeArea()
            TabView(selection: $tab) {
                NavigationStack { HomeView(player: player, link: { pairing = true }, importFiles: { imported = true }) }.tabItem { Label("Inicio", systemImage: "house") }.tag(0)
                NavigationStack { SongList(player: player, title: "Tu música", ids: nil, downloadedOnly: false) }.tabItem { Label("Biblioteca", systemImage: "music.note.list") }.tag(1)
                NavigationStack { SongList(player: player, title: "Descargadas", ids: nil, downloadedOnly: true) }.tabItem { Label("Descargas", systemImage: "arrow.down.circle") }.tag(2)
                NavigationStack { SyncView(player: player, pair: { pairing = true }) }.tabItem { Label("Sincronizar", systemImage: "arrow.triangle.2.circlepath") }.tag(3)
            }.scrollContentBackground(.hidden)
        }
        .tint(Color(glassHex: library.state.accent)).preferredColorScheme(.dark)
        .safeAreaInset(edge: .bottom, spacing: 8) { MiniPlayer(player: player, open: { nowPlaying = true }).padding(.horizontal, 12) }
        .sheet(isPresented: $pairing) { PairView(initial: incomingCode).environmentObject(library).environmentObject(sync) }
        .sheet(isPresented: $nowPlaying) { NowPlayingView(player: player).environmentObject(library).presentationDragIndicator(.visible) }
        .fileImporter(isPresented: $imported, allowedContentTypes: [UTType(filenameExtension: "flac") ?? .audio, .mp3], allowsMultipleSelection: true) { result in
            switch result { case .success(let urls): Task { await library.importFiles(urls) }; case .failure(let error): library.message = error.localizedDescription }
        }
        .alert("Glass Music", isPresented: Binding(get: { library.message != nil }, set: { if !$0 { library.message = nil } })) { Button("Entendido") { library.message = nil } } message: { Text(library.message ?? "") }
        .onOpenURL { url in if url.scheme == "glassmusic" { incomingCode = url.absoluteString; pairing = true } }
    }
}
struct Artwork: View {
    @EnvironmentObject private var library: Library
    let id: String
    var size: CGFloat = 56
    var body: some View {
        Group { if let image = library.cover(id) { Image(uiImage: image).resizable().scaledToFill() }
            else { ZStack { LinearGradient(colors: [Color(glassHex: library.state.accent).opacity(0.28), .white.opacity(0.04)], startPoint: .topLeading, endPoint: .bottomTrailing); Image(systemName: "waveform").font(.system(size: size * 0.32)).foregroundStyle(Color(glassHex: library.state.accent)) } }
        }.frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: size * 0.18))
    }
}
struct HomeView: View {
    @EnvironmentObject private var library: Library
    let player: MusicPlayer
    let link: () -> Void
    let importFiles: () -> Void
    @State private var create = false
    private var lists: [Playlist] { library.state.playlists + library.state.localPlaylists }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 26) {
                HStack(spacing: 10) { Image(systemName: "waveform").foregroundStyle(Color(glassHex: library.state.accent)); Text("glass").bold() + Text("music").foregroundColor(.secondary); Spacer(); Text("LOCAL PLAYER").font(.caption2).tracking(2).foregroundStyle(.secondary) }.font(.title3)
                VStack(alignment: .leading, spacing: 10) { Text("Tu música.\nContigo.").font(.system(size: 44, weight: .bold, design: .rounded)); Text("\(library.state.name) · \(library.downloaded.count) canciones sin conexión").font(.subheadline).foregroundStyle(.secondary) }
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
                HStack { Text("Tus playlists").font(.title2.bold()); Spacer(); Button { create = true } label: { Image(systemName: "plus.circle") }.accessibilityLabel("Crear playlist local") }
                if lists.isEmpty { Text("Tus playlists de la PC aparecerán aquí al sincronizar. También puedes crear una lista local.").foregroundStyle(.secondary).padding(.vertical) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 145), spacing: 16)], spacing: 22) {
                    ForEach(lists) { playlist in NavigationLink { SongList(player: player, title: playlist.name, ids: playlist.trackIds, downloadedOnly: false, source: "playlist:" + playlist.id) } label: {
                        VStack(alignment: .leading, spacing: 10) { GeometryReader { geometry in Artwork(id: "playlist:" + playlist.id, size: geometry.size.width) }.aspectRatio(1, contentMode: .fit); Text(playlist.name).font(.headline).lineLimit(1); Text("\(playlist.trackIds.count) canciones\(playlist.revision == "local" ? " · En este iPhone" : "")").font(.caption).foregroundStyle(.secondary) }
                    }.buttonStyle(.plain) }
                }
                Button(action: importFiles) { Label("Añadir música local", systemImage: "plus") }.buttonStyle(.bordered).padding(.vertical)
            }.padding(22).padding(.bottom, 20)
        }.background(.clear).navigationBarTitleDisplayMode(.inline)
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
    @State private var search = ""
    private var songs: [Song] {
        let list: [Song]
        if let ids { let map = Dictionary(uniqueKeysWithValues: library.state.songs.map { ($0.id, $0) }); list = ids.compactMap { map[$0] } }
        else { list = library.state.songs.sorted { ($0.modifiedAt ?? 0) > ($1.modifiedAt ?? 0) } }
        return list.filter { (!downloadedOnly || library.file($0.id) != nil) && (search.isEmpty || "\($0.title) \($0.artist) \($0.album)".localizedCaseInsensitiveContains(search)) }
    }
    var body: some View {
        List {
            if !songs.isEmpty {
                Section {
                    HStack { Button { if let first = songs.first(where: { library.file($0.id) != nil }) { player.play(first, ids: songs.map(\.id), source: source) } } label: { Label("Reproducir", systemImage: "play.fill") }.buttonStyle(.borderedProminent)
                        Spacer(); if !downloadedOnly, library.state.link != nil { Button { sync.download(songs.map(\.id)) } label: { Image(systemName: "arrow.down.circle") }.disabled(sync.busy).accessibilityLabel("Descargar esta lista") }
                    }.listRowBackground(Color.clear)
                }
            }
            ForEach(songs) { song in SongRow(song: song, player: player, context: songs.map(\.id), source: source) }.listRowBackground(Color.white.opacity(0.035))
            if songs.isEmpty { ContentUnavailableView(search.isEmpty ? "Tu música aparecerá aquí" : "Sin resultados", systemImage: "music.note", description: Text("Sincroniza tu PC o importa archivos FLAC y MP3." )).listRowBackground(Color.clear) }
        }.scrollContentBackground(.hidden).listStyle(.insetGrouped).navigationTitle(title).searchable(text: $search, prompt: "Canciones, artistas, álbumes")
        .onChange(of: search) { _, _ in player.updateSearch(source: source, ids: songs.map(\.id)) }
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
            Button { player.play(song, ids: context, source: source) } label: { HStack(spacing: 12) { Artwork(id: song.id, size: 48); VStack(alignment: .leading, spacing: 5) { Text(song.title).font(.subheadline.weight(.semibold)).foregroundStyle(.primary).lineLimit(1); Text(song.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1) } }.contentShape(Rectangle()) }.buttonStyle(.plain)
            Spacer(minLength: 0)
            if library.file(song.id) == nil { Button { sync.download([song.id]) } label: { Image(systemName: "arrow.down.circle") }.disabled(sync.busy || library.state.localIds.contains(song.id)).accessibilityLabel("Descargar \(song.title)") }
            else { Image(systemName: "checkmark.circle.fill").font(.caption).foregroundStyle(.secondary).accessibilityLabel("Disponible sin conexión") }
            Menu {
                Button(song.favorite ? "Quitar de Me gusta" : "Me gusta", systemImage: song.favorite ? "heart.slash" : "heart") { library.favorite(song.id) }
                Button("Editar letra", systemImage: "text.quote") { editor = true }
                if library.file(song.id) != nil { Button("Quitar descarga del iPhone", systemImage: "trash", role: .destructive) { removing = true } }
            } label: { Image(systemName: "ellipsis").padding(.vertical, 10) }.accessibilityLabel("Opciones de \(song.title)")
        }.padding(.vertical, 5)
        .sheet(isPresented: $editor) { LyricsEditorView(song: song).environmentObject(library) }
        .confirmationDialog("¿Quitar la descarga de este iPhone?", isPresented: $removing, titleVisibility: .visible) { Button("Quitar descarga", role: .destructive) { if player.current?.id == song.id { player.pause() }; library.removeDownload(song.id) } } message: { Text("La canción y su letra se conservan en la PC.") }
    }
}
struct MiniPlayer: View {
    @EnvironmentObject private var library: Library
    @ObservedObject var player: MusicPlayer
    let open: () -> Void
    var body: some View {
        if let song = player.current {
            HStack(spacing: 12) { Button(action: open) { HStack(spacing: 12) { Artwork(id: song.id, size: 44); VStack(alignment: .leading, spacing: 4) { Text(song.title).font(.subheadline.bold()).foregroundStyle(.primary).lineLimit(1); Text(song.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1) } }.frame(maxWidth: .infinity, alignment: .leading) }.buttonStyle(.plain).accessibilityLabel("Abrir reproductor")
                Button { player.toggle() } label: { Image(systemName: player.playing ? "pause.fill" : "play.fill").frame(width: 36, height: 36) }.accessibilityLabel(player.playing ? "Pausar" : "Reproducir")
                Button { player.next() } label: { Image(systemName: "forward.end.fill").frame(width: 30, height: 36) }.accessibilityLabel("Siguiente")
            }.padding(12).background(.regularMaterial, in: RoundedRectangle(cornerRadius: 24)).overlay(RoundedRectangle(cornerRadius: 24).stroke(.white.opacity(0.12)))
        }
    }
}
