import AVFoundation
import CoreTransferable
import UniformTypeIdentifiers
import SwiftUI

struct ListeningStory: View {
    let period: String
    let minutes: Int
    let songs: [String]
    let tint: Color
    let ranking: Bool

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(red: 0.04, green: 0.08, blue: 0.16), tint.opacity(0.43), Color(red: 0.09, green: 0.05, blue: 0.16)], startPoint: .topLeading, endPoint: .bottomTrailing)
            Circle().strokeBorder(.white.opacity(0.16), lineWidth: 1).frame(width: 330).offset(x: 145, y: -170)
            VStack(alignment: .leading, spacing: 14) {
                Label("Glass Music", systemImage: "waveform").font(.headline).foregroundStyle(tint)
                Text(period).font(.subheadline.monospaced()).foregroundStyle(.white.opacity(0.72))
                Spacer()
                if ranking {
                    Text("Tus 5 más escuchadas").font(.system(size: 38, weight: .black, design: .rounded))
                    ForEach(Array(songs.enumerated()), id: \.offset) { index, song in
                        HStack(spacing: 12) {
                            Text(String(format: "%02d", index + 1)).monospacedDigit().foregroundStyle(tint)
                            Text(song).lineLimit(2)
                        }.font(.system(size: 17, weight: .semibold)).frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12).background(.white.opacity(0.09), in: RoundedRectangle(cornerRadius: 15))
                    }
                } else {
                    Text(minutes.formatted()).font(.system(size: 82, weight: .black, design: .rounded)).minimumScaleFactor(0.45).lineLimit(1)
                    Text("minutos de música").font(.system(size: 32, weight: .bold, design: .rounded))
                }
                Spacer()
            }.padding(32)
        }.foregroundStyle(.white).frame(width: 360, height: 640).clipped()
    }
}

private struct StoryFile: Transferable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(exportedContentType: .mpeg4Movie) { story in SentTransferredFile(story.url) }
    }
}

struct ListeningShareView: View {
    let period: String
    let minutes: Int
    let songs: [String]
    let tint: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var ranking = false
    @State private var generating = false
    @State private var file: URL?
    @State private var error: String?

    private func card(_ ranking: Bool) -> ListeningStory {
        ListeningStory(period: period, minutes: minutes, songs: songs, tint: tint, ranking: ranking)
    }
    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                GeometryReader { geometry in
                    let width = min(300, geometry.size.width)
                    card(ranking).id(ranking)
                        .transition(.opacity.combined(with: .scale(scale: 0.95)))
                        .scaleEffect(width / 360).frame(width: geometry.size.width, height: geometry.size.height)
                }.frame(height: 534).accessibilityHidden(true)
                Button(ranking ? "Ver minutos" : "Ver top 5") {
                    withAnimation(reduceMotion ? nil : .spring(response: 0.4, dampingFraction: 0.85)) { ranking.toggle() }
                }.buttonStyle(.bordered)
                if let file {
                    ShareLink(item: StoryFile(url: file), preview: SharePreview("Glass Music")) {
                        Label("Compartir video", systemImage: "square.and.arrow.up")
                    }.buttonStyle(.borderedProminent)
                } else {
                    Button("Preparar video vertical", systemImage: "film") { export() }
                        .buttonStyle(.borderedProminent).disabled(generating)
                }
                if generating { ProgressView("Preparando video…") }
                if let error { Text(error).font(.caption).foregroundStyle(.secondary) }
            }.padding(20)
        }.navigationTitle("Compartir resumen")
    }
    @MainActor private func export() {
        generating = true; error = nil
        let first = ImageRenderer(content: card(false))
        let second = ImageRenderer(content: card(true))
        first.scale = 2; second.scale = 2
        guard let minutesCard = first.cgImage, let rankingCard = second.cgImage else {
            generating = false; error = "No se pudo preparar la imagen del resumen."; return
        }
        let reduce = reduceMotion
        Task {
            defer { generating = false }
            do { file = try await Task.detached(priority: .userInitiated) { try await StoryVideo.write(minutesCard, rankingCard, animated: !reduce) }.value }
            catch { self.error = error.localizedDescription }
        }
    }
}

private enum StoryVideo {
    static func write(_ first: CGImage, _ second: CGImage, animated: Bool) async throws -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Glass Music " + UUID().uuidString + ".mp4")
        let width = 720, height = 1280, fps: Int32 = 24
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height
        ])
        let attributes: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferCGImageCompatibilityKey as String: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
        ]
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)
        let failure = AppError.message("No se pudo exportar el video.")
        guard writer.canAdd(input) else { throw failure }
        writer.add(input)
        var succeeded = false
        defer {
            if !succeeded { writer.cancelWriting(); try? FileManager.default.removeItem(at: url) }
        }
        guard writer.startWriting() else { throw writer.error ?? failure }
        writer.startSession(atSourceTime: .zero)
        let deadline = ContinuousClock.now.advanced(by: .seconds(45))
        for frame in 0..<(8 * Int(fps)) {
            while !input.isReadyForMoreMediaData {
                guard writer.status == .writing, ContinuousClock.now < deadline else { throw writer.error ?? failure }
                try await Task.sleep(for: .milliseconds(10))
            }
            guard let pool = adaptor.pixelBufferPool else { throw failure }
            var buffer: CVPixelBuffer?
            guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &buffer) == kCVReturnSuccess, let buffer else { throw failure }
            let blend = animated ? min(1.0, max(0, Double(frame - 80) / 18)) : (frame < 96 ? 0.0 : 1.0)
            try paint(buffer, first: first, second: second, blend: blend)
            guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: fps)) else { throw writer.error ?? failure }
        }
        input.markAsFinished()
        await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error ?? failure }
        succeeded = true
        return url
    }
    private static func paint(_ buffer: CVPixelBuffer, first: CGImage, second: CGImage, blend: Double) throws {
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        let width = CVPixelBufferGetWidth(buffer), height = CVPixelBufferGetHeight(buffer)
        let color = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        let bitmap = CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.noneSkipFirst.rawValue
        guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8,
                                      bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: color, bitmapInfo: bitmap) else {
            throw AppError.message("No se pudo preparar un cuadro del video.")
        }
        let bounds = CGRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height))
        if blend < 1 { context.draw(first, in: bounds) }
        if blend > 0 {
            let eased = blend * blend * (3 - 2 * blend)
            context.setAlpha(CGFloat(eased))
            context.draw(second, in: bounds)
        }
    }
}
