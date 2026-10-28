import SwiftUI
import AVFoundation

struct SyncView: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var sync: SyncManager
    let player: MusicPlayer
    let pair: () -> Void
    @State private var unlinking = false
    var body: some View {
        List {
            Section {
                Label("Tu música viaja por tu Wi-Fi", systemImage: "wifi").font(.headline)
                Text("Sin cuentas. Sin datos móviles. Mantén Glass Music abierto en tu PC y conecta ambos a la misma red.").font(.subheadline).foregroundStyle(.secondary)
            }
            Section("Vinculación") {
                if let link = library.state.link {
                    Label("PC vinculada", systemImage: "checkmark.shield")
                    Text("\(link.host):\(link.port)").font(.caption.monospaced()).foregroundStyle(.secondary)
                    Button("Actualizar dirección / escanear otro QR", action: pair).disabled(sync.busy)
                } else { Button(action: pair) { Label("Vincular mi PC", systemImage: "qrcode.viewfinder") } }
            }
            if library.state.link != nil {
                Section("Sincronización") {
                    Button { sync.sync() } label: { Label("Sincronizar ahora", systemImage: "arrow.triangle.2.circlepath") }.disabled(sync.busy)
                    Text(sync.detail).font(.subheadline).foregroundStyle(.secondary)
                    if sync.busy { ProgressView(value: sync.progress); Button("Pausar transferencia", role: .cancel) { sync.cancel() } }
                    if let date = library.state.lastSync { Text("Última sincronización: \(date.formatted(date: .abbreviated, time: .shortened))").font(.caption).foregroundStyle(.secondary) }
                }
            }
            if !library.state.conflicts.isEmpty {
                Section("Letras con cambios en ambos equipos") {
                    ForEach(library.state.conflicts) { conflict in
                        VStack(alignment: .leading, spacing: 12) {
                            Text(library.state.songs.first(where: { $0.id == conflict.id })?.title ?? "Canción").font(.headline)
                            DisclosureGroup("Versión de la PC") { Text(conflict.remote.text).font(.caption).textSelection(.enabled) }
                            DisclosureGroup("Versión de este iPhone") { Text(conflict.change.text ?? "").font(.caption).textSelection(.enabled) }
                            Button("Usar versión de la PC") { library.resolve(conflict, keepMine: false) }.disabled(sync.busy)
                            Button("Conservar versión del iPhone y reenviar") { library.resolve(conflict, keepMine: true); sync.sync() }.disabled(sync.busy)
                        }.padding(.vertical, 6)
                    }
                }
            }
            Section("En este iPhone") {
                Label("\(library.downloaded.count) canciones descargadas", systemImage: "arrow.down.circle.fill")
                Text("Las canciones se guardan dentro de la app. Quitar una descarga no elimina el original de tu PC. La reproducción funciona con el Wi-Fi apagado.").font(.caption).foregroundStyle(.secondary)
                if !library.state.pending.isEmpty { Text("\(library.state.pending.count) cambios pendientes de enviar").font(.subheadline) }
            }
            if library.state.link != nil { Section { Button("Desvincular PC", role: .destructive) { unlinking = true }.disabled(sync.busy) } }
        }.glassScreen().toolbar(.hidden, for: .tabBar).navigationTitle("Sincronizar")
        .confirmationDialog("¿Desvincular esta PC?", isPresented: $unlinking, titleVisibility: .visible) { Button("Desvincular y descartar envíos pendientes", role: .destructive) { library.unlink() } } message: { Text("Tus descargas y letras guardadas seguirán en el iPhone. Se descartarán los cambios pendientes de enviar a esta PC.") }
    }
}
struct PairView: View {
    @EnvironmentObject private var library: Library
    @EnvironmentObject private var sync: SyncManager
    @Environment(\.dismiss) private var dismiss
    var initial: String = ""
    @State private var code = ""
    @State private var scanner = false
    @State private var error: String?
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Image(systemName: "desktopcomputer.and.arrow.down").font(.system(size: 42)).foregroundStyle(library.tint).frame(maxWidth: .infinity).padding()
                    Text("En tu PC abre Ajustes → iPhone y activa la sincronización local. Después genera un QR.")
                    Button { scanner = true } label: { Label("Escanear QR de la PC", systemImage: "qrcode.viewfinder") }
                }
                Section("También puedes pegar el código") {
                    TextEditor(text: $code).frame(minHeight: 110).font(.caption.monospaced()).autocorrectionDisabled().textInputAutocapitalization(.never).accessibilityLabel("Código de vinculación")
                    PasteButton(payloadType: String.self) { strings in if let first = strings.first { code = first } }
                }
                if let error { Text(error).foregroundStyle(.red) }
                Button("Vincular y sincronizar") {
                    Task { do { try await sync.pair(code); dismiss(); sync.sync() } catch { self.error = error.localizedDescription } }
                }.disabled(sync.busy || code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }.glassScreen().navigationTitle("Conectar con tu PC").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancelar") { dismiss() } } }
                .onAppear { code = initial }
                .sheet(isPresented: $scanner) { QRScanner { code = $0; scanner = false }.ignoresSafeArea() }
        }.tint(library.tint).preferredColorScheme(.dark)
    }
}
struct QRScanner: UIViewControllerRepresentable {
    let found: (String) -> Void
    func makeUIViewController(context: Context) -> CameraController { let controller = CameraController(); controller.found = found; return controller }
    func updateUIViewController(_ uiViewController: CameraController, context: Context) {}
    static func dismantleUIViewController(_ uiViewController: CameraController, coordinator: ()) { uiViewController.stop() }
}
final class CameraController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var found: ((String) -> Void)?
    private let capture = AVCaptureSession()
    private let queue = DispatchQueue(label: "com.eaysix.glassmusic.camera")
    private var preview: AVCaptureVideoPreviewLayer?
    private var finished = false
    override func viewDidLoad() {
        super.viewDidLoad(); view.backgroundColor = .black
        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            guard let self else { return }
            if granted { self.queue.async { self.configure() } }
            else { DispatchQueue.main.async { let label = UILabel(); label.text = "Permite el acceso a Cámara en Ajustes o pega el código de tu PC."; label.textColor = .white; label.numberOfLines = 0; label.textAlignment = .center; label.frame = self.view.bounds.insetBy(dx: 30, dy: 50); label.autoresizingMask = [.flexibleWidth, .flexibleHeight]; self.view.addSubview(label) } }
        }
    }
    private func configure() {
        guard let device = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: device), capture.canAddInput(input) else { return }
        capture.addInput(input); let output = AVCaptureMetadataOutput()
        guard capture.canAddOutput(output) else { return }; capture.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main); output.metadataObjectTypes = [.qr]
        DispatchQueue.main.async { let preview = AVCaptureVideoPreviewLayer(session: self.capture); preview.videoGravity = .resizeAspectFill; preview.frame = self.view.bounds; self.view.layer.addSublayer(preview); self.preview = preview }
        capture.startRunning()
    }
    override func viewDidLayoutSubviews() { super.viewDidLayoutSubviews(); preview?.frame = view.bounds }
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !finished, let value = metadataObjects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first else { return }
        finished = true; stop(); found?(value)
    }
    func stop() { queue.async { if self.capture.isRunning { self.capture.stopRunning() } } }
}
