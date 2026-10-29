import SwiftUI
struct PhoneQueueView: View {
    @EnvironmentObject private var library: Library
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var player: MusicPlayer
    var body: some View {
        NavigationStack {
            List {
                if let song = player.current { Section("Sonando ahora") { row(song.id) } }
                Section("Añadidas por ti · en este orden") {
                    if player.current == nil && !player.manualQueue.isEmpty { Button("Reproducir cola") { player.next() } }
                    ForEach(Array(player.manualQueue.enumerated()), id: \.offset) { _, id in row(id) }.onDelete { player.removeManual(at: $0) }
                    if player.manualQueue.isEmpty { Text("Desliza una canción a la derecha para añadirla.").foregroundStyle(.secondary) }
                }
                Section("Después, continúa tu lista") {
                    ForEach(Array(player.automaticQueue.enumerated()), id: \.offset) { _, id in row(id) }
                }
            }.animation(library.phoneAppearance.animations && !reduceMotion ? .spring(response: 0.35, dampingFraction: 0.85) : nil, value: player.manualQueue).glassScreen().navigationTitle("Cola").toolbar { ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } } }
        }.tint(library.tint).preferredColorScheme(.dark)
    }
    private func row(_ id: String) -> some View {
        let song = library.state.songs.first { $0.id == id }
        return HStack { Artwork(id: id, size: 44); VStack(alignment: .leading) { Text(song?.title ?? "No disponible"); Text(song?.artist ?? "").font(.caption).foregroundStyle(.secondary) } }.listRowBackground(Color.white.opacity(0.04))
    }
}
