import SwiftUI

struct NowPlayingView: View {
    @EnvironmentObject private var library: Library
    @ObservedObject var player: MusicPlayer
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var lyrics = false
    @State private var edit = false
    @State private var scrubbing = 0.0
    @State private var editing = false
    var body: some View {
        NavigationStack {
            GeometryReader { geometry in
                VStack(spacing: 22) {
                    HStack { Label("GLASS MUSIC", systemImage: "waveform").font(.caption).tracking(2); Spacer(); Button { lyrics.toggle(); player.detailedLyrics(lyrics) } label: { Image(systemName: lyrics ? "square.stack" : "text.quote") }.accessibilityLabel(lyrics ? "Mostrar portada" : "Mostrar letra") }.foregroundStyle(Color(glassHex: library.state.accent))
                    if let song = player.current {
                        if lyrics { LyricPanel(song: song, player: player).frame(maxHeight: .infinity) }
                        else { Spacer(minLength: 0); Artwork(id: song.id, size: min(geometry.size.width - 10, geometry.size.height * 0.47)).shadow(color: .black.opacity(0.35), radius: 22, y: 15); Spacer(minLength: 0) }
                        HStack { VStack(alignment: .leading, spacing: 7) { Text(song.title).font(.title2.bold()).lineLimit(2); Text(song.artist).font(.subheadline).foregroundStyle(.secondary).lineLimit(1) }; Spacer(); Button { library.favorite(song.id) } label: { Image(systemName: library.state.songs.first(where: { $0.id == song.id })?.favorite == true ? "heart.fill" : "heart") }.font(.title2).accessibilityLabel("Me gusta") }
                        VStack(spacing: 5) {
                            Slider(value: Binding(get: { min(editing ? scrubbing : player.position, max(1, song.duration)) }, set: { scrubbing = $0 }), in: 0...max(1, song.duration), onEditingChanged: { value in if value { scrubbing = player.position }; editing = value; if !value { player.seek(scrubbing) } }).accessibilityLabel("Posición de reproducción")
                            HStack { Text(clock(editing ? scrubbing : player.position)); Spacer(); Text(clock(song.duration)) }.font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        }
                        HStack(spacing: 30) {
                            Button { player.shuffle.toggle() } label: { Image(systemName: "shuffle").foregroundStyle(player.shuffle ? Color(glassHex: library.state.accent) : .secondary) }.accessibilityLabel("Aleatorio")
                            Button { player.previous() } label: { Image(systemName: "backward.end.fill").font(.title2) }.accessibilityLabel("Anterior")
                            Button { player.toggle() } label: { Image(systemName: player.playing ? "pause.fill" : "play.fill").font(.title).frame(width: 74, height: 74).foregroundStyle(.black).background(Color(glassHex: library.state.accent).gradient, in: Circle()) }.accessibilityLabel(player.playing ? "Pausar" : "Reproducir")
                            Button { player.next() } label: { Image(systemName: "forward.end.fill").font(.title2) }.accessibilityLabel("Siguiente")
                            Button { player.repeatAll.toggle() } label: { Image(systemName: "repeat").foregroundStyle(player.repeatAll ? Color(glassHex: library.state.accent) : .secondary) }.accessibilityLabel("Repetir lista")
                        }.frame(maxWidth: .infinity)
                        HStack { Label("En este iPhone · \(song.format)", systemImage: "checkmark.circle"); Spacer(); Button("Editar letra") { edit = true } }.font(.caption).foregroundStyle(.secondary)
                    } else { ContentUnavailableView("Elige una canción", systemImage: "music.note") }
                }.padding(24)
            }
            .background(LinearGradient(colors: [Color(glassHex: library.state.accent).opacity(0.15), Color(red: 0.045, green: 0.055, blue: 0.09)], startPoint: .topLeading, endPoint: .bottomTrailing).ignoresSafeArea())
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Listo") { dismiss() } } }
        }.preferredColorScheme(.dark)
        .sheet(isPresented: $edit) { if let song = player.current { LyricsEditorView(song: song).environmentObject(library) } }
        .onDisappear { player.detailedLyrics(false) }
        .onChange(of: phase) { _, value in player.detailedLyrics(value == .active && lyrics) }
    }
}
struct LyricPanel: View {
    @EnvironmentObject private var library: Library
    let song: Song
    @ObservedObject var player: MusicPlayer
    @State private var lines: [LyricLine] = []
    private var raw: String { library.state.lyrics[song.id]?.text ?? "" }
    private var active: Int? { Lyrics.active(lines, at: player.position) }
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 26) {
                    if lines.isEmpty { Text(raw.isEmpty ? "Esta canción aún no tiene letra. Puedes traerla de tu PC o escribirla aquí." : raw).font(.title3.weight(.semibold)).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                    ForEach(Array(lines.enumerated()), id: \.element.id) { index, line in
                        Button { player.seek(line.time) } label: { lyricText(line, index: index).font(.system(size: 29, weight: .bold, design: .rounded)).multilineTextAlignment(.leading).frame(maxWidth: .infinity, alignment: .leading) }.buttonStyle(.plain).id(index)
                    }
                }.padding(.vertical, 28)
            }
            .onChange(of: raw, initial: true) { _, value in lines = Lyrics.parse(value) }
            .onChange(of: active) { _, value in if let value { withAnimation(.easeInOut(duration: 0.3)) { proxy.scrollTo(value, anchor: .center) } } }
        }
    }
    private func lyricText(_ line: LyricLine, index: Int) -> Text {
        let isActive = active == index
        if isActive && !line.words.isEmpty {
            return line.words.enumerated().reduce(Text("")) { result, pair in
                let (i, word) = pair
                let color = word.time <= player.position ? Color(glassHex: library.state.accent) : .white.opacity(0.35)
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
            }.padding(20).navigationTitle("Editar letra").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Guardar") { library.editLyrics(song.id, text: text); dismiss() }.disabled(text.utf8.count > 1024 * 1024) } }
            .onAppear { if !loaded { text = library.state.lyrics[song.id]?.text ?? ""; loaded = true } }
        }.preferredColorScheme(.dark)
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
            }.navigationTitle("Nueva playlist").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }; ToolbarItem(placement: .confirmationAction) { Button("Crear") { library.createLocalPlaylist(name: name, ids: library.downloaded.filter { selected.contains($0.id) }.map(\.id)); dismiss() }.disabled(name.trimmingCharacters(in: .whitespaces).isEmpty) } }
        }.preferredColorScheme(.dark)
    }
}
