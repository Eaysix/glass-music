import Foundation
struct LyricWord: Equatable { var time: Double; var text: String; var separator: String }
struct LyricLine: Equatable, Identifiable {
    var id: Int
    var time: Double
    var text: String
    var words: [LyricWord]
}
enum Lyrics {
    private static func matches(_ pattern: String, _ text: String) -> [NSTextCheckingResult] {
        (try? NSRegularExpression(pattern: pattern)).map { $0.matches(in: text, range: NSRange(text.startIndex..., in: text)) } ?? []
    }
    private static func group(_ match: NSTextCheckingResult, _ at: Int, _ text: String) -> String {
        guard at < match.numberOfRanges, let range = Range(match.range(at: at), in: text) else { return "" }
        return String(text[range])
    }
    private static func seconds(_ match: NSTextCheckingResult, _ text: String) -> Double {
        (Double(group(match, 1, text)) ?? 0) * 60 + (Double(group(match, 2, text)) ?? 0) + (Double("0." + group(match, 3, text)) ?? 0)
    }
    static func parse(_ source: String) -> [LyricLine] {
        let linePattern = #"\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]"#
        let wordPattern = #"<(\d+):(\d{2})(?:[.:](\d{1,3}))?>"#
        let offset = matches(#"\[offset:([+-]?\d+)\]"#, source).first.map { (Double(group($0, 1, source)) ?? 0) / 1000 } ?? 0
        var physical: [String] = []
        for row in source.components(separatedBy: .newlines) {
            if matches(linePattern, row).isEmpty && !matches(wordPattern, row).isEmpty && !physical.isEmpty { physical[physical.count - 1] += " " + row.trimmingCharacters(in: .whitespaces) }
            else { physical.append(row) }
        }
        var result: [LyricLine] = []
        for row in physical {
            let stamps = matches(linePattern, row)
            guard let first = stamps.first else { continue }
            let content = row.replacingOccurrences(of: #"\[[^\]]*\]"#, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"^\s*v\d+:\s*"#, with: "", options: .regularExpression)
            let tags = matches(wordPattern, content)
            let ns = content as NSString
            var words: [LyricWord] = []
            for (i, tag) in tags.enumerated() {
                let start = tag.range.location + tag.range.length
                let end = i + 1 < tags.count ? tags[i + 1].range.location : ns.length
                let raw = ns.substring(with: NSRange(location: start, length: end - start))
                let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { continue }
                words.append(LyricWord(time: seconds(tag, content) + offset, text: text, separator: raw.last?.isWhitespace == true ? " " : ""))
            }
            let clean = content.replacingOccurrences(of: wordPattern, with: "", options: .regularExpression)
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
            for stamp in stamps {
                let delta = seconds(stamp, row) - seconds(first, row)
                result.append(LyricLine(id: result.count, time: max(0, seconds(stamp, row) + offset), text: clean,
                    words: words.map { LyricWord(time: max(0, $0.time + delta), text: $0.text, separator: $0.separator) }))
            }
        }
        return result.sorted { $0.time == $1.time ? $0.id < $1.id : $0.time < $1.time }
    }
    static func active(_ lines: [LyricLine], at time: Double) -> Int? {
        var low = 0, high = lines.count
        while low < high { let mid = (low + high) / 2; if lines[mid].time <= time { low = mid + 1 } else { high = mid } }
        return low == 0 ? nil : low - 1
    }
}
