import SwiftUI
struct LyricsEditorView: View {
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject var player: MusicPlayer
    let song: Song
    init(song: Song, player: MusicPlayer) { self.song = song; self.player = player }
    @State private var text = ""
    @State private var loaded = false
    @State private var mode = "text"
    @State private var draft = LyricTimingDraft("")
    private var words: Bool { mode == "words" }
    private var result: String? { mode == "text" ? text : draft.encoded(words: words) }
    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text(song.title).font(.headline).lineLimit(1).accessibilityIdentifier("lyrics-song-title")
                Picker("Editor", selection: $mode) { Text("Texto").tag("text"); Text("Líneas").tag("lines"); Text("Palabras").tag("words") }.pickerStyle(.segmented)
                if mode == "text" {
                    TextEditor(text: $text).font(.body.monospaced()).accessibilityLabel("Letra y tiempos LRC").scrollContentBackground(.hidden).padding(10).background(.thinMaterial, in: RoundedRectangle(cornerRadius: 20))
                    Text("Escribe un verso por línea y después elige Líneas o Palabras para marcar sus tiempos.").font(.caption).foregroundStyle(.secondary)
                } else {
                    timingList
                    HStack {
                        Button(player.current?.id == song.id && player.playing ? "Pausar" : "Reproducir") {
                            if player.current?.id == song.id { player.toggle() } else { player.play(song, ids: library.downloaded.map(\.id)) }
                        }.buttonStyle(.bordered).disabled(library.file(song.id) == nil).accessibilityIdentifier("lyrics-transport")
                        Text(clock(player.position)).monospacedDigit(); Spacer()
                        Button("Deshacer") { draft.undoMark() }.disabled(!draft.canUndo)
                    }
                    if player.current?.id == song.id {
                        Slider(value: Binding(get: { min(player.position, max(1, song.duration)) }, set: { player.seek($0) }), in: 0...max(1, song.duration)).accessibilityLabel("Escuchar desde")
                    }
                    if draft.cursor < draft.count(words: words) {
                        HStack {
                            Text("Tiempo seleccionado")
                            TextField("Segundos", value: Binding(get: { draft.time(words: words) ?? player.position }, set: { draft.mark($0, words: words, advance: false) }), format: .number.precision(.fractionLength(3))).keyboardType(.decimalPad).textFieldStyle(.roundedBorder).frame(width: 110)
                        }.font(.caption)
                    }
                    Button { draft.mark(player.position, words: words) } label: { Label(words ? "Marcar palabra y seguir" : "Marcar línea y seguir", systemImage: "record.circle").frame(maxWidth: .infinity).padding(.vertical, 12) }.buttonStyle(.borderedProminent).disabled(player.current?.id != song.id || !player.playing || draft.cursor >= draft.count(words: words))
                    Text(result == nil ? "Completa los tiempos en orden antes de guardar. Toca una línea o palabra para corregirla." : "Tiempos listos para guardar.").font(.caption).foregroundStyle(.secondary)
                }
            }.padding(20).glassScreen().navigationTitle("Editar letra").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } }
                    ToolbarItem(placement: .confirmationAction) { Button("Guardar") { if let result { library.editLyrics(song.id, text: result); dismiss() } }.disabled(result == nil || (result?.utf8.count ?? 0) > 1024 * 1024) }
                }
                .onAppear { if !loaded { text = library.state.lyrics[song.id]?.text ?? ""; draft = LyricTimingDraft(text); loaded = true } }
                .onChange(of: text) { _, value in if mode == "text" { draft = LyricTimingDraft(value) } }
                .onChange(of: mode) { _, _ in draft.cursor = 0; player.detailedLyrics(mode != "text") }
                .onDisappear { player.detailedLyrics(false) }
        }.tint(library.tint).preferredColorScheme(.dark)
    }
    private var timingList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    ForEach(draft.rows.indices, id: \.self) { row in
                        let base = draft.rows.prefix(row).reduce(0) { $0 + $1.tokens.count }
                        if words {
                            VStack(alignment: .leading, spacing: 8) {
                                Text(draft.rows[row].text).font(.headline)
                                LazyVGrid(columns: [GridItem(.adaptive(minimum: 85))], alignment: .leading) {
                                    ForEach(draft.rows[row].tokens.indices, id: \.self) { token in
                                        let index = base + token
                                        Button { draft.cursor = index } label: { Text(draft.rows[row].tokens[token].text).padding(8).frame(maxWidth: .infinity).background(draft.cursor == index ? library.tint.opacity(0.3) : .white.opacity(0.04), in: RoundedRectangle(cornerRadius: 12)) }.buttonStyle(.plain)
                                    }
                                }
                            }.id(row)
                        } else {
                            Button { draft.cursor = row } label: { HStack { Text(draft.rows[row].time.map(clock) ?? "—").font(.caption.monospacedDigit()); Text(draft.rows[row].text).font(.title3.bold()); Spacer() }.padding(12).background(draft.cursor == row ? library.tint.opacity(0.2) : .white.opacity(0.04), in: RoundedRectangle(cornerRadius: 16)) }.buttonStyle(.plain).id(row)
                        }
                    }
                }
            }.onChange(of: draft.cursor) { _, index in
                let row = words ? draft.location(index)?.0 : index
                if let row { withAnimation(library.phoneAppearance.animations && !reduceMotion ? .easeInOut(duration: 0.25) : nil) { proxy.scrollTo(row, anchor: .center) } }
            }
        }
    }
}
