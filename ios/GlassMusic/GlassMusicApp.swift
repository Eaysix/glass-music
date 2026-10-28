import SwiftUI

@MainActor final class Application: ObservableObject {
    let library: Library?
    let player: MusicPlayer?
    let sync: SyncManager?
    let failure: String?
    init() {
        do {
            let library = try Library(database: SnapshotDatabase())
            let player = MusicPlayer(library: library)
            self.library = library; self.player = player; sync = SyncManager(library: library, player: player); failure = nil
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-reset-appearance") { library.updateAppearance(PhoneAppearance()) }
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-fixtures"), library.state.songs.isEmpty {
                Task { let files = ["first.flac", "second.mp3"].compactMap { Bundle.main.url(forResource: $0, withExtension: nil, subdirectory: "Fixtures") ?? Bundle.main.url(forResource: $0, withExtension: nil) }; await library.importFiles(files) }
            }
            #endif
        } catch { library = nil; player = nil; sync = nil; failure = error.localizedDescription }
    }
}
@main @MainActor struct GlassMusicApp: App {
    @StateObject private var application = Application()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            if let library = application.library, let player = application.player, let sync = application.sync {
                RootView(player: player).environmentObject(library).environmentObject(sync)
                    .onChange(of: phase) { _, value in if value != .active { player.persist(); player.detailedLyrics(false) } }
            } else { ContentUnavailableView("No se pudo abrir la biblioteca", systemImage: "externaldrive.badge.exclamationmark", description: Text(application.failure ?? "")) }
        }
    }
}
extension Color {
    init(glassHex: String) {
        let text = glassHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let value = UInt64(text, radix: 16) ?? 0x8CCDF3
        self.init(red: Double((value >> 16) & 255) / 255, green: Double((value >> 8) & 255) / 255, blue: Double(value & 255) / 255)
    }
}
func clock(_ seconds: Double) -> String { let n = Int(max(0, seconds.isFinite ? seconds : 0)); return "\(n / 60):\(String(format: "%02d", n % 60))" }
struct GlassCard: ViewModifier {
    func body(content: Content) -> some View { content.padding(18).glassSurface() }
}
extension View { func glassCard() -> some View { modifier(GlassCard()) } }
