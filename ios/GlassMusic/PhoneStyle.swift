import SwiftUI
import UIKit

struct PhoneAppearance: Codable, Equatable {
    var profileName = ""
    var hasAvatar = false
    var accent = "#8CCDF3"
    var useComputerAccent = false
    var backdrop = "aurora"
    var hud = "normal"
    var glassStrength = 0.4
    var lyricSize = 29.0
    var largeArtwork = true
    var animations = true

    var hudScale: Double { hud == "compact" ? 0.9 : (hud == "large" ? 1.1 : 1) }
    func sanitized() -> Self {
        var value = self
        value.profileName = String(profileName.prefix(60))
        value.accent = Self.validHex(accent) ? accent.uppercased() : "#8CCDF3"
        value.glassStrength = glassStrength.isFinite ? min(0.8, max(0.1, glassStrength)) : 0.4
        value.lyricSize = lyricSize.isFinite ? min(44, max(22, lyricSize)) : 29
        return value
    }
    static func validHex(_ value: String) -> Bool {
        value.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil
    }
}

extension Library {
    var tint: Color { Color(glassHex: effectiveAccent) }
}

// Decode once, normalize to standard RGB and keep small artwork in memory.
// Avoid decoding a full-size/extended-range image on each playback tick.
enum PhoneImages {
    static func thumbnail(_ image: UIImage, maxSide: CGFloat, square: Bool = false) -> UIImage {
        let longest = max(image.size.width, image.size.height)
        let factor = min(1, maxSide / max(1, longest))
        let size = square ? CGSize(width: maxSide, height: maxSide) : CGSize(width: max(1, image.size.width * factor), height: max(1, image.size.height * factor))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = true; format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: size, format: format).image { renderer in
            UIColor.black.setFill(); renderer.fill(CGRect(origin: .zero, size: size))
            let scale = square ? max(size.width / max(1, image.size.width), size.height / max(1, image.size.height)) : factor
            let bounds = CGRect(x: (size.width - image.size.width * scale) / 2, y: (size.height - image.size.height * scale) / 2, width: image.size.width * scale, height: image.size.height * scale)
            renderer.cgContext.interpolationQuality = .high
            image.draw(in: bounds)
        }
    }
}

@MainActor private enum Backdrops {
    static let cache = NSCache<NSString, UIImage>()
    static func image(style: String, hex: String) -> UIImage {
        let key = (style + hex) as NSString
        if let image = cache.object(forKey: key) { return image }
        let size = CGSize(width: 512, height: 1024)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1; format.opaque = true; format.preferredRange = .standard
        let image = UIGraphicsImageRenderer(size: size, format: format).image { renderer in
            let context = renderer.cgContext
            let graphite = style == "graphite"
            let colors: [CGColor] = graphite
                ? [UIColor(red: 0.16, green: 0.17, blue: 0.20, alpha: 1).cgColor, UIColor(red: 0.055, green: 0.06, blue: 0.08, alpha: 1).cgColor]
                : [UIColor(red: 0.075, green: 0.11, blue: 0.18, alpha: 1).cgColor, UIColor(red: 0.025, green: 0.035, blue: 0.065, alpha: 1).cgColor]
            let space = CGColorSpaceCreateDeviceRGB()
            if let gradient = CGGradient(colorsSpace: space, colors: colors as CFArray, locations: [0, 1]) {
                context.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: 512, y: 1024), options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
            }
            if style == "aurora" {
                let color = UIColor(Color(glassHex: hex))
                let stops = [color.withAlphaComponent(0.32).cgColor, color.withAlphaComponent(0).cgColor]
                if let glow = CGGradient(colorsSpace: space, colors: stops as CFArray, locations: [0, 1]) {
                    context.drawRadialGradient(glow, startCenter: CGPoint(x: 30, y: 130), startRadius: 0, endCenter: CGPoint(x: 30, y: 130), endRadius: 570, options: [])
                }
                let violet = UIColor(red: 0.36, green: 0.27, blue: 0.58, alpha: 0.22)
                if let glow = CGGradient(colorsSpace: space, colors: [violet.cgColor, violet.withAlphaComponent(0).cgColor] as CFArray, locations: [0, 1]) {
                    context.drawRadialGradient(glow, startCenter: CGPoint(x: 510, y: 740), startRadius: 0, endCenter: CGPoint(x: 510, y: 740), endRadius: 480, options: [])
                }
            }
        }
        cache.countLimit = 8; cache.setObject(image, forKey: key)
        return image
    }
}

// Core Animation moves two small gradient layers; no SwiftUI frame timer or artwork decoding.
private struct AuroraMotion: UIViewRepresentable {
    var tint: UIColor
    var active: Bool
    func makeUIView(context: Context) -> AuroraLayerView { AuroraLayerView() }
    func updateUIView(_ view: AuroraLayerView, context: Context) { view.configure(tint: tint, active: active) }
    static func dismantleUIView(_ view: AuroraLayerView, coordinator: ()) { view.stop() }
}
private final class AuroraLayerView: UIView {
    private let first = CAGradientLayer()
    private let second = CAGradientLayer()
    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        for glow in [first, second] {
            glow.type = .radial; glow.startPoint = CGPoint(x: 0.5, y: 0.5); glow.endPoint = CGPoint(x: 1, y: 1)
            layer.addSublayer(glow)
        }
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin(); CATransaction.setDisableActions(true)
        first.frame = CGRect(x: -bounds.width * 0.8, y: -bounds.height * 0.25, width: bounds.width * 1.8, height: bounds.height * 1.2)
        second.frame = CGRect(x: bounds.width * 0.15, y: bounds.height * 0.25, width: bounds.width * 1.4, height: bounds.height)
        CATransaction.commit()
    }
    func configure(tint: UIColor, active: Bool) {
        CATransaction.begin(); CATransaction.setDisableActions(true)
        first.colors = [tint.withAlphaComponent(0.3).cgColor, tint.withAlphaComponent(0).cgColor]
        second.colors = [tint.withAlphaComponent(0.17).cgColor, UIColor(red: 0.42, green: 0.27, blue: 0.66, alpha: 0.12).cgColor, UIColor.clear.cgColor]
        CATransaction.commit()
        guard active else { stop(); return }
        for (index, glow) in [first, second].enumerated() where glow.animation(forKey: "aurora-drift") == nil {
            let drift = CABasicAnimation(keyPath: "transform")
            drift.fromValue = NSValue(caTransform3D: CATransform3DMakeTranslation(index == 0 ? -35 : 30, index == 0 ? 25 : -35, 0))
            drift.toValue = NSValue(caTransform3D: CATransform3DScale(CATransform3DMakeTranslation(index == 0 ? 60 : -45, index == 0 ? -45 : 50, 0), 1.12, 1.12, 1))
            drift.duration = index == 0 ? 14 : 19
            drift.autoreverses = true; drift.repeatCount = .infinity
            drift.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            glow.add(drift, forKey: "aurora-drift")
        }
    }
    func stop() { first.removeAllAnimations(); second.removeAllAnimations() }
}
struct GlassBackdrop: View {
    @EnvironmentObject private var library: Library
    @Environment(\.scenePhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @State private var visible = false
    @State private var lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Image(uiImage: Backdrops.image(style: library.phoneAppearance.backdrop, hex: library.effectiveAccent))
                    .resizable().scaledToFill().frame(width: geometry.size.width, height: geometry.size.height)
                if library.phoneAppearance.backdrop == "aurora", !reduceTransparency {
                    AuroraMotion(tint: UIColor(library.tint), active: visible && phase == .active && library.phoneAppearance.animations && !reduceMotion && !lowPower)
                }
            }.frame(width: geometry.size.width, height: geometry.size.height).clipped()
        }.ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
            .onAppear { visible = true }.onDisappear { visible = false }
            .onReceive(NotificationCenter.default.publisher(for: .NSProcessInfoPowerStateDidChange)) { _ in lowPower = ProcessInfo.processInfo.isLowPowerModeEnabled }
    }
}

struct GlassSurface: ViewModifier {
    @EnvironmentObject private var library: Library
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var radius: CGFloat = 26
    var chrome = false
    @ViewBuilder func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        let strength = library.phoneAppearance.glassStrength
        if #available(iOS 26, *), chrome, !reduceTransparency {
            content.glassEffect(.regular.tint(library.tint.opacity(0.05 + strength * 0.18)).interactive(library.phoneAppearance.animations && !reduceMotion), in: shape)
        } else {
            content
                .background {
                    if reduceTransparency { shape.fill(Color(red: 0.13, green: 0.16, blue: 0.21)) }
                    else {
                        shape.fill(.ultraThinMaterial).opacity(0.55 + strength * 0.5)
                        shape.fill(library.tint.opacity(0.025 + strength * 0.06))
                        shape.fill(.white.opacity(0.025 + strength * 0.065))
                    }
                }
                .overlay(shape.strokeBorder(.white.opacity(reduceTransparency ? 0.25 : 0.12 + strength * 0.16), lineWidth: 0.8))
                .shadow(color: .black.opacity(0.16), radius: 12, x: 0, y: 7)
        }
    }
}

struct GlassPressStyle: ButtonStyle {
    @EnvironmentObject private var library: Library
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed && library.phoneAppearance.animations && !reduceMotion ? 0.97 : 1)
            .animation(library.phoneAppearance.animations && !reduceMotion ? .spring(response: 0.28, dampingFraction: 0.65) : nil, value: configuration.isPressed)
    }
}

extension View {
    func glassSurface(radius: CGFloat = 26, chrome: Bool = false) -> some View { modifier(GlassSurface(radius: radius, chrome: chrome)) }
    func glassScreen() -> some View { scrollContentBackground(.hidden).background { GlassBackdrop() }.toolbarBackground(.hidden, for: .navigationBar) }
}
