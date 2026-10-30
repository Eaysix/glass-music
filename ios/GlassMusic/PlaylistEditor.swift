import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
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
    @State private var deleting = false
    @State private var importFiles = false
    @State private var importingFiles = false
    private var filtered: [Song] {
        library.state.songs.filter { search.isEmpty || "\($0.title) \($0.artist) \($0.album)".localizedCaseInsensitiveContains(search) }
    }
    var body: some View {
        let tint = library.tint
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 18) {
                        PhotosPicker(selection: $photo, matching: .images) {
                            Group {
                                if let cover, let image = UIImage(data: cover) { Image(uiImage: image).resizable().scaledToFill() }
                                else if let playlistID { Artwork(id: "playlist:" + playlistID, size: 96) }
                                else { ZStack { tint.opacity(0.15); Image(systemName: "photo.badge.plus").font(.largeTitle).foregroundStyle(tint) } }
                            }.frame(width: 96, height: 96).clipShape(RoundedRectangle(cornerRadius: 20))
                        }.accessibilityLabel("Cambiar portada de la playlist")
                        VStack(alignment: .leading, spacing: 10) {
                            TextField("Nombre de la playlist", text: $name).font(.headline)
                            Text("\(selected.count) canciones seleccionadas").font(.caption).foregroundStyle(.secondary)
                            Text("Toca la portada para cambiarla").font(.caption2).foregroundStyle(library.tint)
                        }
                    }.padding(.vertical, 12)
                }.listRowBackground(Color.white.opacity(0.04))
                importSection
                songSection
                if playlistID != nil {
                    Section { Button("Eliminar playlist", role: .destructive) { deleting = true }.accessibilityIdentifier("delete-playlist") }
                }
            }.glassScreen().searchable(text: $search, prompt: "Canciones, artistas, álbumes")
                .navigationTitle(playlistID == nil ? "Crea tu playlist" : "Edita tu playlist").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() }.disabled(saving) }
                    ToolbarItem(placement: .confirmationAction) { Button(saving ? "Guardando…" : "Guardar") { save() }.disabled(saving || importingFiles || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) }
                }
                .fileImporter(isPresented: $importFiles, allowedContentTypes: [UTType(filenameExtension: "flac") ?? .audio, .mp3], allowsMultipleSelection: true) { result in
                    switch result {
                    case .success(let urls): Task {
                        importingFiles = true
                        let ids = await library.importFiles(urls)
                        var seen = Set(selected); selected += ids.filter { seen.insert($0).inserted }
                        importingFiles = false
                    }
                    case .failure(let error): self.error = error.localizedDescription
                    }
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
                .confirmationDialog("¿Eliminar esta playlist?", isPresented: $deleting, titleVisibility: .visible) {
                    Button("Eliminar playlist", role: .destructive) { if let playlistID { library.deletePlaylist(playlistID); dismiss() } }
                } message: { Text("Las canciones y sus descargas se conservan. La eliminación se enviará a tu PC al sincronizar.") }
                .alert("Playlist", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) { Button("Listo") { error = nil } } message: { Text(error ?? "") }
        }.tint(library.tint).preferredColorScheme(.dark)
    }
    private var importSection: some View {
        Section {
            Button { importFiles = true } label: { Label(importingFiles ? "Importando…" : "Importar archivos a esta playlist", systemImage: "folder.badge.plus") }.disabled(importingFiles).accessibilityIdentifier("import-playlist-files")
        } footer: { Text("Los archivos elegidos se seleccionan automáticamente. Guarda la playlist para conservar su selección.") }
    }
    private var songSection: some View {
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
        } header: { Text("Añade canciones") } footer: { Text("La playlist se sincroniza con tu PC cuando conectas ambos equipos. Las canciones importadas solo en el iPhone siguen siendo locales.") }
    }
    private func save() {
        saving = true
        Task {
            let id: String?
            if let existing = playlistID ?? createdID { library.updateLocalPlaylist(existing, name: name, ids: selected); id = existing }
            else { id = library.createLocalPlaylist(name: name, ids: selected); createdID = id }
            do { if let id, let cover { try await library.storeCoverAsync("playlist:" + id, data: cover, revision: digest(cover)); library.queuePlaylist(id, cover: cover); library.persist() }; dismiss() }
            catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}
