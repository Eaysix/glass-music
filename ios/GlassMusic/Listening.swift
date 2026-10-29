import Foundation
import SwiftUI

struct ListeningDay: Codable, Equatable {
    var songs: [String: Double] = [:]
    var seconds: Double { songs.values.reduce(0, +) }
}
struct ListeningHistory: Codable {
    var days: [String: ListeningDay] = [:]
    static func key(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
    mutating func record(id: String, seconds: Double, ending: Date, calendar: Calendar = .current) {
        guard seconds.isFinite, seconds > 0, seconds <= 86400 else { return }
        var start = ending.addingTimeInterval(-seconds)
        while start < ending {
            let boundary = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: start)) ?? ending
            let end = min(ending, boundary)
            let key = Self.key(start, calendar: calendar)
            var day = days[key] ?? ListeningDay()
            day.songs[id, default: 0] += end.timeIntervalSince(start); days[key] = day
            start = end
        }
    }
    func totals(from start: Date, to end: Date, calendar: Calendar = .current) -> [String: Double] {
        let low = Self.key(start, calendar: calendar), high = Self.key(end, calendar: calendar)
        return days.filter { $0.key >= low && $0.key < high }.values.reduce(into: [:]) { result, day in
            for (id, seconds) in day.songs { result[id, default: 0] += seconds }
        }
    }
}
@MainActor final class ListeningStore {
    private(set) var history: ListeningHistory
    private let url: URL
    private let io = DispatchQueue(label: "com.eaysix.glassmusic.listening")
    private var dirty = false
    private var accumulated = 0.0
    init(root: URL) {
        url = root.appendingPathComponent("listening.json")
        history = (try? JSONDecoder().decode(ListeningHistory.self, from: Data(contentsOf: url))) ?? ListeningHistory()
    }
    func record(id: String, seconds: Double, ending: Date = Date()) {
        history.record(id: id, seconds: seconds, ending: ending)
        dirty = true; accumulated += seconds
        if accumulated >= 30 { flush() }
    }
    func flush() {
        guard dirty else { return }; dirty = false; accumulated = 0
        let snapshot = history, destination = url
        io.async { if let data = try? JSONEncoder().encode(snapshot) { try? data.write(to: destination, options: .atomic) } }
    }
}

struct ListeningStatsView: View {
    @EnvironmentObject private var library: Library
    @Environment(\.dismiss) private var dismiss
    @State private var history = ListeningHistory()
    @State private var annual = false
    @State private var offset = 0
    private var interval: DateInterval {
        let calendar = Calendar.current
        let component: Calendar.Component = annual ? .year : .weekOfYear
        let anchor = calendar.date(byAdding: component, value: offset, to: Date()) ?? Date()
        return calendar.dateInterval(of: component, for: anchor) ?? DateInterval(start: anchor, duration: 86400)
    }
    private var totals: [String: Double] { history.totals(from: interval.start, to: interval.end) }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    Picker("Período", selection: $annual) { Text("Semana").tag(false); Text("Resumen anual").tag(true) }.pickerStyle(.segmented).onChange(of: annual) { _, _ in offset = 0 }
                    HStack {
                        Button { offset -= 1 } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }.accessibilityLabel("Período anterior")
                        Spacer()
                        Text(interval.start, format: annual ? .dateTime.year() : .dateTime.day().month().year()).font(.headline)
                        Spacer()
                        Button { offset += 1 } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }.disabled(offset >= 0).accessibilityLabel("Período siguiente")
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(Int(totals.values.reduce(0, +) / 60))").font(.system(size: 56, weight: .bold, design: .rounded)).foregroundStyle(library.tint)
                        Text("minutos escuchados en este iPhone").foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity, alignment: .leading).glassCard()
                    Text("Tus 5 canciones más escuchadas").font(.title2.bold())
                    let ranked = totals.sorted { $0.value == $1.value ? $0.key < $1.key : $0.value > $1.value }.prefix(5)
                    if ranked.isEmpty { Text("Tu resumen empieza con lo que escuches desde esta actualización.").foregroundStyle(.secondary) }
                    ForEach(Array(ranked.enumerated()), id: \.element.key) { index, item in
                        let song = library.state.songs.first { $0.id == item.key }
                        HStack { Text("\(index + 1)").foregroundStyle(library.tint); Artwork(id: item.key, size: 44); VStack(alignment: .leading) { Text(song?.title ?? "Canción fuera de la biblioteca").lineLimit(1); Text(song?.artist ?? "").font(.caption).foregroundStyle(.secondary) }; Spacer(); Text("\(Int(item.value / 60)) min").font(.caption.monospacedDigit()) }.glassCard()
                    }
                    Text("Se cuenta reproducción efectiva, no pausas ni saltos. Historial local de este dispositivo; todavía no se suman los minutos de PC e iPhone.").font(.caption).foregroundStyle(.secondary)
                }.padding(22)
            }.glassScreen().navigationTitle("Tu música en números")
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Listo") { dismiss() } } }
                .onAppear { history = library.listening.history }
        }.tint(library.tint).preferredColorScheme(.dark)
    }
}
