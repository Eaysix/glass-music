import Foundation
struct TimingToken: Equatable { var text: String; var time: Double? }
struct TimingRow: Equatable { var text: String; var time: Double?; var tokens: [TimingToken] }
struct LyricTimingDraft {
    var rows: [TimingRow]
    var cursor = 0
    private var undo: [([TimingRow], Int)] = []
    init(_ text: String) {
        var physical: [String] = []
        for row in text.components(separatedBy: .newlines) {
            if row.range(of: #"^\s*<\d+:"#, options: .regularExpression) != nil, !physical.isEmpty { physical[physical.count - 1] += " " + row }
            else { physical.append(row) }
        }
        let offset = text.range(of: #"\[offset:[+-]?\d+\]"#, options: .regularExpression).map { String(text[$0]) } ?? ""
        rows = physical.flatMap { row -> [TimingRow] in
            let parsed = Lyrics.parse(offset + "\n" + row)
            if !parsed.isEmpty {
                return parsed.map { line in TimingRow(text: line.text, time: line.time, tokens: line.words.isEmpty ? Self.tokens(line.text) : line.words.map { TimingToken(text: $0.text + $0.separator, time: $0.time) }) }
            }
            let clean = row.trimmingCharacters(in: .whitespaces)
            if clean.isEmpty || clean.range(of: #"^\[[A-Za-z]+:[^\]]*\]$"#, options: .regularExpression) != nil { return [] }
            return [TimingRow(text: row, time: nil, tokens: Self.tokens(row))]
        }
        if rows.allSatisfy({ $0.time != nil }) {
            rows = rows.enumerated().sorted { a, b in a.element.time == b.element.time ? a.offset < b.offset : a.element.time! < b.element.time! }.map(\.element)
        }
    }
    private static func tokens(_ text: String) -> [TimingToken] {
        var starts: [String.Index] = []
        text.enumerateSubstrings(in: text.startIndex..., options: .byWords) { _, range, _, _ in starts.append(range.lowerBound) }
        guard !starts.isEmpty else { return [TimingToken(text: text, time: nil)] }
        starts[0] = text.startIndex
        return starts.indices.map { i in TimingToken(text: String(text[starts[i]..<(i + 1 < starts.count ? starts[i + 1] : text.endIndex)]), time: nil) }
    }
    func count(words: Bool) -> Int { words ? rows.reduce(0) { $0 + $1.tokens.count } : rows.count }
    func location(_ index: Int) -> (Int, Int)? {
        var offset = 0
        for row in rows.indices { if index < offset + rows[row].tokens.count { return (row, index - offset) }; offset += rows[row].tokens.count }
        return nil
    }
    func time(words: Bool) -> Double? {
        if words, let (r, w) = location(cursor) { return rows[r].tokens[w].time }
        return rows.indices.contains(cursor) ? rows[cursor].time : nil
    }
    mutating func mark(_ seconds: Double, words: Bool, advance: Bool = true) {
        guard seconds.isFinite, seconds >= 0, cursor < count(words: words) else { return }
        undo.append((rows, cursor)); if undo.count > 200 { undo.removeFirst() }
        if words, let (r, w) = location(cursor) { rows[r].tokens[w].time = seconds; if w == 0 { rows[r].time = seconds } }
        else if rows.indices.contains(cursor) {
            let delta = seconds - (rows[cursor].time ?? seconds)
            rows[cursor].time = seconds
            for w in rows[cursor].tokens.indices { if let time = rows[cursor].tokens[w].time { rows[cursor].tokens[w].time = max(0, time + delta) } }
        }
        if advance { cursor += 1 }
    }
    mutating func undoMark() { if let value = undo.popLast() { rows = value.0; cursor = value.1 } }
    var canUndo: Bool { !undo.isEmpty }
    func encoded(words: Bool) -> String? {
        guard !rows.isEmpty else { return nil }
        var previous = -Double.infinity
        var result: [String] = []
        for row in rows {
            guard let time = row.time, time.isFinite, time >= 0, time >= previous else { return nil }
            let anyWords = row.tokens.contains { $0.time != nil }
            if words || anyWords {
                var last = time
                for token in row.tokens { guard let t = token.time, t.isFinite, t >= last else { return nil }; last = t }
                previous = time
                result.append(Self.stamp(time, word: false) + row.tokens.map { Self.stamp($0.time!, word: true) + $0.text }.joined())
            } else { previous = time; result.append(Self.stamp(time, word: false) + row.text) }
        }
        return result.joined(separator: "\n")
    }
    private static func stamp(_ time: Double, word: Bool) -> String {
        let ms = Int((max(0, time) * 1000).rounded()), minutes = ms / 60000
        return String(format: word ? "<%02d:%02d.%03d>" : "[%02d:%02d.%03d]", minutes, (ms / 1000) % 60, ms % 1000)
    }
}
