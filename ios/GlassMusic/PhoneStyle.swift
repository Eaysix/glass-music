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

struct GlassBackdrop: View {
    @EnvironmentObject private var library: Library
    var body: some View {
        GeometryReader { geometry in
            Image(uiImage: Backdrops.image(style: library.phoneAppearance.backdrop, hex: library.effectiveAccent))
                .resizable().scaledToFill().frame(width: geometry.size.width, height: geometry.size.height).clipped()
        }.ignoresSafeArea().allowsHitTesting(false).accessibilityHidden(true)
    }
}

struct GlassSurface: ViewModifier {
    @EnvironmentObject private var library: Library
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    var radius: CGFloat = 26
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        let strength = library.phoneAppearance.glassStrength
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

struct GlassPressStyle: ButtonStyle {
    @EnvironmentObject private var library: Library
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed && library.phoneAppearance.animations && !reduceMotion ? 0.97 : 1)
            .animation(library.phoneAppearance.animations && !reduceMotion ? .easeOut(duration: 0.18) : nil, value: configuration.isPressed)
    }
}

extension View {
    func glassSurface(radius: CGFloat = 26) -> some View { modifier(GlassSurface(radius: radius)) }
    func glassScreen() -> some View { scrollContentBackground(.hidden).background { GlassBackdrop() }.toolbarBackground(.hidden, for: .navigationBar) }
}
