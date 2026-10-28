import SwiftUI

struct NowPlayingView: View {
    @EnvironmentObject private var library: Library
    @ObservedObject var player: MusicPlayer
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var lyrics = false
    @State private var edit = false
    @State private var appearance = false
    @State private var scrubbing = 0.0
    @State private var editing = false
    private var motion: Animation? { library.phoneAppearance.animations && !reduceMotion ? .easeInOut(duration: 0.24) : nil }
    var body: some View {
        GeometryReader { geometry in
            let available = max(160, geometry.size.width - 44)
            let preferred = geometry.size.height * (library.phoneAppearance.largeArtwork ? 0.46 : 0.36)
            let artSize = min(available, 440, max(160, min(preferred, geometry.size.height - 340)))
            VStack(spacing: 0) {
                header.padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 10)
                ScrollView {
                    if let song = player.current {
                        VStack(spacing: 22) {
                            if lyrics {
                                LyricPanel(song: song, player: player).frame(height: max(230, artSize)).padding(.horizontal, 4)
                                    .transition(.opacity)
                            } else {
                                Artwork(id: song.id, size: artSize - 14).padding(7).glassSurface(radius: 32)
                                    .id(song.id).transition(.opacity).padding(.vertical, 6)
                            }
                            metadata(song)
                            timeline(song)
                            transport
                            HStack {
                                Label(song.format + " · Sin conexión", systemImage: "checkmark.circle.fill").font(.caption)
                                Spacer()
                                Button { edit = true } label: { Label("Editar letra", systemImage: "pencil.line") }.font(.caption).frame(minHeight: 44)
                            }.foregroundStyle(.secondary)
                            Button { appearance = true } label: { Label("Personalizar", systemImage: "slider.horizontal.3").font(.subheadline).frame(maxWidth: .infinity).padding(.vertical, 12) }.glassSurface(radius: 20).buttonStyle(GlassPressStyle())
                        }.frame(maxWidth: 520).padding(.horizontal, 22).padding(.top, 6).padding(.bottom, 24).frame(maxWidth: .infinity)
                    } else { ContentUnavailableView("Elige una canción", systemImage: "music.note") }
                }.scrollBounceBehavior(.basedOnSize)
            }
        }.background { GlassBackdrop() }.tint(library.tint).preferredColorScheme(.dark)
        .sheet(isPresented: $edit) { if let song = player.current { LyricsEditorView(song: song).environmentObject(library).tint(library.tint) } }
        .sheet(isPresented: $appearance) {
            NavigationStack { PhoneSettingsView().toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Listo") { appearance = false } } } }.environmentObject(library).tint(library.tint).preferredColorScheme(.dark)
        }
        .animation(motion, value: lyrics).animation(motion, value: player.current?.id)
        .onDisappear { player.detailedLyrics(false) }
        .onChange(of: phase) { _, value in player.detailedLyrics(value == .active && lyrics) }
    }
    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "waveform").font(.title3)
            Text("GLASS MUSIC").font(.system(size: 10, weight: .semibold)).tracking(2.2)
            Spacer(minLength: 8)
            Button { lyrics.toggle(); player.detailedLyrics(lyrics) } label: {
                Image(systemName: lyrics ? "square.stack" : "text.quote").font(.system(size: 19)).frame(width: 44, height: 44)
            }.glassSurface(radius: 17).buttonStyle(GlassPressStyle()).accessibilityLabel(lyrics ? "Mostrar portada" : "Mostrar letra")
            Button { dismiss() } label: { Image(systemName: "chevron.down").font(.system(size: 17, weight: .semibold)).frame(width: 44, height: 44) }.buttonStyle(GlassPressStyle()).accessibilityLabel("Cerrar reproductor")
        }.foregroundStyle(library.tint)
    }
    private func metadata(_ song: Song) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(song.title).font(.system(size: 25 * library.phoneAppearance.hudScale, weight: .bold, design: .rounded)).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                Text(song.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }.frame(maxWidth: .infinity, alignment: .leading)
            Button { library.favorite(song.id) } label: {
                Image(systemName: library.state.songs.first(where: { $0.id == song.id })?.favorite == true ? "heart.fill" : "heart").font(.system(size: 23)).frame(width: 44, height: 44)
            }.buttonStyle(GlassPressStyle()).accessibilityLabel("Me gusta")
        }
    }
    private func timeline(_ song: Song) -> some View {
        VStack(spacing: 5) {
            Slider(value: Binding(get: { min(editing ? scrubbing : player.position, max(1, song.duration)) }, set: { scrubbing = $0 }), in: 0...max(1, song.duration), onEditingChanged: { value in
                if value { scrubbing = player.position }
                editing = value
                if !value { player.seek(scrubbing) }
            }).accessibilityLabel("Posición de reproducción")
            HStack { Text(clock(editing ? scrubbing : player.position)); Spacer(); Text(clock(song.duration)) }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
        }
    }
    private var transport: some View {
        HStack(spacing: 0) {
            Button { player.toggleShuffle() } label: { Image(systemName: "shuffle").font(.system(size: 20)).foregroundStyle(player.shuffle ? library.tint : Color.white.opacity(0.5)).frame(width: 44, height: 48) }.accessibilityLabel("Aleatorio")
            Spacer(minLength: 2)
            Button { player.previous() } label: { Image(systemName: "backward.end.fill").font(.system(size: 25)).frame(width: 44, height: 48) }.accessibilityLabel("Anterior")
            Spacer(minLength: 6)
            Button { player.toggle() } label: { Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.system(size: 29, weight: .semibold)).frame(width: 76, height: 76).foregroundStyle(Color(red: 0.035, green: 0.06, blue: 0.09)).background(library.tint, in: Circle()).overlay(Circle().strokeBorder(.white.opacity(0.22), lineWidth: 1)) }.accessibilityLabel(player.playing ? "Pausar" : "Reproducir").accessibilityIdentifier("full-player-play-pause")
            Spacer(minLength: 6)
            Button { player.next() } label: { Image(systemName: "forward.end.fill").font(.system(size: 25)).frame(width: 44, height: 48) }.accessibilityLabel("Siguiente")
            Spacer(minLength: 2)
            Button { player.toggleRepeat() } label: { Image(systemName: "repeat").font(.system(size: 20)).foregroundStyle(player.repeatAll ? library.tint : Color.white.opacity(0.5)).frame(width: 44, height: 48) }.accessibilityLabel("Repetir lista")
        }.foregroundStyle(library.tint).buttonStyle(GlassPressStyle()).padding(.vertical, 2)
    }
}
struct LyricPanel: View {
    @EnvironmentObject private var library: Library
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let song: Song
    @ObservedObject var player: MusicPlayer
    @State private var lines: [LyricLine] = []
    private var raw: String { library.state.lyrics[song.id]?.text ?? "" }
    private var active: Int? { Lyrics.active(lines, at: player.position) }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 26) {
                    if lines.isEmpty { Text(raw.isEmpty ? "Esta canción aún no tiene letra. Puedes traerla de tu PC o escribirla aquí." : raw).font(.system(size: library.phoneAppearance.lyricSize, weight: .semibold, design: .rounded)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                    ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
                        Button { player.seek(line.time) } label: { lyricText(line, index: index).font(.system(size: library.phoneAppearance.lyricSize, weight: .bold, design: .rounded)).multilineTextAlignment(.leading).frame(maxWidth: .infinity, alignment: .leading) }.buttonStyle(.plain).id(index)
                    }
                }.padding(.vertical, 28)
            }
            .onChange(of: raw, initial: true) { _, value in lines = Lyrics.parse(value) }
            .onChange(of: active) { _, value in if let value { withAnimation(library.phoneAppearance.animations && !reduceMotion ? .easeInOut(duration: 0.3) : nil) { proxy.scrollTo(value, anchor: .center) } } }
        }
    }
    private func lyricText(_ line: LyricLine, index: Int) -> Text {
        let isActive = active == index
        if isActive && !line.words.isEmpty {
            return line.words.enumerated().reduce(Text("")) { result, pair in
                let (i, word) = pair
                let color = word.time <= player.position ? library.tint : .white.opacity(0.35)
                return result + Text(word.text + (i < line.words.count - 1 ? word.separator : "")).foregroundColor(color)
            }
        }
        return Text(line.text.isEmpty ? "♪" : line.text).foregroundColor(isActive ? .white : .white.opacity(index < (active ?? 0) ? 0.45 : 0.25))
    }
}
struct LyricsEditorView: View {
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    let song: Song
    @State private var text = ""
    @State private var loaded = false
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                Text(song.title).font(.headline)
                Text("La letra se guarda en este iPhone. Si la canción viene de la PC, se enviará al sincronizar. Conserva las etiquetas LRC si quieres mantener los tiempos por línea o palabra.").font(.subheadline).foregroundStyle(.secondary)
                TextEditor(text: $text).font(.body.monospaced()).accessibilityLabel("Letra y tiempos LRC").scrollContentBackground(.hidden).padding(12).background(.thinMaterial, in: RoundedRectangle(cornerRadius: 18))
                Text("Los archivos de audio originales no se modifican.").font(.caption).foregroundStyle(.secondary)
            }.padding(20).glassScreen().navigationTitle("Editar letra").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Guardar") { library.editLyrics(song.id, text: text); dismiss() }.disabled(text.utf8.count > 1024 * 1024) } }
            .onAppear { if !loaded { text = library.state.lyrics[song.id]?.text ?? ""; loaded = true } }
        }.tint(library.tint).preferredColorScheme(.dark)
    }
}
struct LocalPlaylistView: View {
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var selected: Set<String> = []
    var body: some View {
        NavigationStack {
            List {
                TextField("Nombre de la playlist", text: $name)
                Text("Esta lista se guarda solo en este iPhone. Las playlists de tu PC se reciben al sincronizar.").font(.caption).foregroundStyle(.secondary)
                ForEach(library.downloaded) { song in Button { if selected.contains(song.id) { selected.remove(song.id) } else { selected.insert(song.id) } } label: { HStack { VStack(alignment: .leading) { Text(song.title).foregroundStyle(.primary); Text(song.artist).font(.caption).foregroundStyle(.secondary) }; Spacer(); Image(systemName: selected.contains(song.id) ? "checkmark.circle.fill" : "circle") } } }
            }.glassScreen().navigationTitle("Nueva playlist").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Crear") { library.createLocalPlaylist(name: name, ids: library.downloaded.filter { selected.contains($0.id) }.map(\.id)); dismiss() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty) } }
        }.tint(library.tint).preferredColorScheme(.dark)
    }
}
