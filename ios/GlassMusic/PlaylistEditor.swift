import SwiftUI
import PhotosUI
struct LocalPlaylistView: View {
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    var playlistID: String? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var createdID: String?
    @State private var name = ""
    @State private var selected: [String] = []
    @State private var search = ""
    @State private var photo: PhotosPickerItem?
    @State private var cover: Data?
    @State private var saving = false
    @State private var loaded = false
    @State private var error: String?
    private var filtered: [Song] {
        library.state.songs.filter { search.isEmpty || "\($0.title) \($0.artist) \($0.album)".localizedCaseInsensitiveContains(search) }
    }
    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 18) {
                        PhotosPicker(selection: $photo, matching: .images) {
                            Group {
                                if let cover, let image = UIImage(data: cover) { Image(uiImage: image).resizable().scaledToFill() }
                                else if let playlistID { Artwork(id: "playlist:" + playlistID, size: 96) }
                                else { ZStack { library.tint.opacity(0.15); Image(systemName: "photo.badge.plus").font(.largeTitle).foregroundStyle(library.tint) } }
                            }.frame(width: 96, height: 96).clipShape(RoundedRectangle(cornerRadius: 20))
                        }.accessibilityLabel("Cambiar portada de la playlist")
                        VStack(alignment: .leading, spacing: 10) {
                            TextField("Nombre de la playlist", text: $name).font(.headline)
                            Text("\(selected.count) canciones seleccionadas").font(.caption).foregroundStyle(.secondary)
                            Text("Toca la portada para cambiarla").font(.caption2).foregroundStyle(library.tint)
                        }
                    }.padding(.vertical, 12)
                }.listRowBackground(Color.white.opacity(0.04))
                Section {
                    ForEach(filtered) { song in
                        Button {
                            withAnimation(library.phoneAppearance.animations && !reduceMotion ? .easeInOut(duration: 0.18) : nil) {
                                if let index = selected.firstIndex(of: song.id) { selected.remove(at: index) } else { selected.append(song.id) }
                            }
                        } label: {
                            HStack(spacing: 12) {
                                Artwork(id: song.id, size: 42)
                                VStack(alignment: .leading, spacing: 4) { Text(song.title).foregroundStyle(.primary).lineLimit(1); Text(song.artist).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                                Spacer()
                                Image(systemName: selected.contains(song.id) ? "checkmark.circle.fill" : "circle").foregroundStyle(library.tint)
                            }.frame(minHeight: 48).contentShape(Rectangle())
                        }.buttonStyle(GlassPressStyle()).accessibilityIdentifier("playlist-select-" + song.id)
                    }
                } header: { Text("Añade canciones") } footer: { Text("La playlist se guarda en este iPhone. Las canciones de PC necesitan descargarse para reproducirse.") }
            }.glassScreen().searchable(text: $search, prompt: "Canciones, artistas, álbumes")
                .navigationTitle(playlistID == nil ? "Crea tu playlist" : "Edita tu playlist").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() }.disabled(saving) }
                    ToolbarItem(placement: .confirmationAction) { Button(saving ? "Guardando…" : "Guardar") { save() }.disabled(saving || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }
                .onAppear {
                    guard !loaded else { return }; loaded = true
                    if let playlistID, let list = library.state.localPlaylists.first(where: { $0.id == playlistID }) { name = list.name; selected = list.trackIds }
                }
                .onChange(of: photo) { _, item in Task {
                    do {
                        guard let data = try await item?.loadTransferable(type: Data.self), data.count <= 30 * 1024 * 1024 else { throw AppError.message("Elige una portada menor de 30 MB.") }
                        let normalized = await Task.detached(priority: .utility) { UIImage(data: data).flatMap { PhoneImages.thumbnail($0, maxSide: 512).jpegData(compressionQuality: 0.9) } }.value
                        cover = normalized
                    } catch { self.error = error.localizedDescription }
                } }
                .alert("Playlist", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("Listo") { error = nil } } message: { Text(error ?? "") }
        }.tint(library.tint).preferredColorScheme(.dark)
    }
    private func save() {
        saving = true
        Task {
            let id: String?
            if let existing = playlistID ?? createdID { library.updateLocalPlaylist(existing, name: name, ids: selected); id = existing }
            else { id = library.createLocalPlaylist(name: name, ids: selected); createdID = id }
            do { if let id, let cover { try await library.storeCoverAsync("playlist:" + id, data: cover, revision: digest(cover)) }; dismiss() }
            catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}
