import SwiftUI
import PhotosUI

struct ProfileAvatar: View {
    @EnvironmentObject private var library: Library
    var size: CGFloat = 70
    var body: some View {
        Group {
            if let photo = library.avatar { Image(uiImage: photo).resizable().scaledToFill() }
            else { ZStack { library.tint.opacity(0.15); Image(systemName: "person.crop.circle").resizable().scaledToFit().padding(size * 0.19).foregroundStyle(library.tint) } }
        }.frame(width: size, height: size).clipShape(Circle()).overlay(Circle().strokeBorder(.white.opacity(0.22), lineWidth: 1))
    }
}

struct PhoneSettingsView: View {
    @EnvironmentObject private var library: Library
    @State private var photo: PhotosPickerItem?
    @State private var photoError: String?
    @FocusState private var editingName: Bool
    private var versionLabel: String {
        let info = Bundle.main.infoDictionary ?? [:]
        return "iPhone \(info["CFBundleShortVersionString"] as? String ?? "—") · build \(info["CFBundleVersion"] as? String ?? "—")"
    }
    private let presets = ["#8CCDF3", "#A6E9DC", "#BDA9FA", "#F3A6CB", "#F5CA8C", "#F28888"]
    private func setting<Value>(_ key: WritableKeyPath<PhoneAppearance, Value>) -> Binding<Value> {
        Binding(get: { library.phoneAppearance[keyPath: key] }, set: { value in var appearance = library.phoneAppearance; appearance[keyPath: key] = value; library.updateAppearance(appearance, save: false) })
    }
    var body: some View {
        Form {
            Section {
                HStack(spacing: 18) {
                    ProfileAvatar(size: 70)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(library.displayName).font(.headline)
                        PhotosPicker(selection: $photo, matching: .images) { Label("Cambiar foto", systemImage: "photo") }.accessibilityIdentifier("change-avatar")
                        if library.phoneAppearance.hasAvatar { Button("Quitar foto", role: .destructive) { do { try library.setAvatar(nil) } catch { photoError = error.localizedDescription } } }
                    }
                }.padding(.vertical, 8)
                TextField("Nombre de tu perfil", text: setting(\.profileName), prompt: Text(library.state.name)).textContentType(.nickname).submitLabel(.done).focused($editingName).onSubmit { editingName = false }.accessibilityIdentifier("profile-name")
            } header: { Text("Tu perfil") } footer: { Text("Tu nombre y foto se guardan en este iPhone. Deja el nombre vacío para usar el de tu PC.") }
            Section {
                Toggle("Usar el color de mi PC", isOn: setting(\.useComputerAccent)).accessibilityIdentifier("follow-pc-accent")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 4)], spacing: 8) {
                    ForEach(presets, id: \.self) { hex in
                        Button {
                            var value = library.phoneAppearance; value.accent = hex; value.useComputerAccent = false; library.updateAppearance(value, save: false)
                        } label: {
                            Circle().fill(Color(glassHex: hex)).frame(width: 30, height: 30)
                                .overlay { if library.effectiveAccent.uppercased() == hex { Image(systemName: "checkmark").font(.caption.bold()).foregroundStyle(.black) } }.frame(width: 44, height: 44)
                        }.buttonStyle(GlassPressStyle()).accessibilityLabel("Color " + hex).accessibilityIdentifier("accent-" + String(hex.dropFirst()))
                    }
                }
                ColorPicker("Color personalizado", selection: Binding(get: { library.tint }, set: { color in
                    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
                    guard UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a) else { return }
                    var value = library.phoneAppearance
                    value.accent = String(format: "#%02X%02X%02X", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
                    value.useComputerAccent = false; library.updateAppearance(value, save: false)
                }), supportsOpacity: false)
                Text(library.effectiveAccent.uppercased()).font(.caption.monospaced()).foregroundStyle(.secondary).accessibilityIdentifier("selected-accent")
            } header: { Text("Color principal") } footer: { Text("Se aplica a los controles, la navegación y las palabras de la letra.") }
            Section("Cristal y fondo") {
                Picker("Fondo", selection: setting(\.backdrop)) {
                    Text("Aurora").tag("aurora"); Text("Medianoche").tag("midnight"); Text("Grafito").tag("graphite")
                }.accessibilityIdentifier("backdrop-picker")
                VStack(alignment: .leading, spacing: 10) {
                    Text("Intensidad del cristal")
                    Slider(value: setting(\.glassStrength), in: 0.1...0.8).accessibilityLabel("Intensidad del cristal")
                    HStack { Text("Ligero"); Spacer(); Text("Definido") }.font(.caption).foregroundStyle(.secondary)
                }
                Toggle("Animaciones suaves", isOn: setting(\.animations))
            }
            Section("Tamaño y reproductor") {
                Picker("Tamaño del HUD", selection: setting(\.hud)) {
                    Text("Compacto").tag("compact"); Text("Normal").tag("normal"); Text("Grande").tag("large")
                }.pickerStyle(.segmented).accessibilityIdentifier("hud-size")
                Toggle("Portada grande", isOn: setting(\.largeArtwork))
                VStack(alignment: .leading, spacing: 10) {
                    HStack { Text("Tamaño de la letra"); Spacer(); Text("\(Int(library.phoneAppearance.lyricSize)) pt").monospacedDigit().foregroundStyle(.secondary) }
                    Slider(value: setting(\.lyricSize), in: 22...44, step: 1).accessibilityLabel("Tamaño de la letra")
                    Text("Tu música, a tu manera.").font(.system(size: library.phoneAppearance.lyricSize, weight: .bold, design: .rounded)).foregroundStyle(library.tint)
                }
            }
            Section {
                Button("Restablecer apariencia") { library.resetAppearance() }
            } footer: { Text("Estas opciones son propias del iPhone y se conservan al sincronizar. Glass Music · \(versionLabel)") }
        }
        .listRowBackground(Color.white.opacity(0.045))
        .glassScreen().toolbar(.hidden, for: .tabBar).tint(library.tint)
        .navigationTitle("A tu manera").navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        .task(id: library.phoneAppearance) {
            do { try await Task.sleep(for: .milliseconds(350)); library.persist() } catch { }
        }
        .onDisappear { library.persist() }
        .onChange(of: photo) { _, item in
            Task {
                do { if let bytes = try await item?.loadTransferable(type: Data.self) { try library.setAvatar(bytes) } }
                catch { photoError = error.localizedDescription }
            }
        }
        .alert("Foto de perfil", isPresented: Binding(get: { photoError != nil }, set: { if !$0 { photoError = nil } })) { Button("Entendido") { photoError = nil } } message: { Text(photoError ?? "") }
    }
}
