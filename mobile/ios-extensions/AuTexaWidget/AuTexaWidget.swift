import WidgetKit
import SwiftUI

// ── Data model ──────────────────────────────────────────────────
struct WidgetDashboardData: Codable {
    var revenue: Double
    var checksCount: Int
    var profitToday: Double
    var shiftOpen: Bool
    var updatedAt: String

    static let placeholder = WidgetDashboardData(
        revenue: 0, checksCount: 0, profitToday: 0, shiftOpen: false, updatedAt: ""
    )
}

func loadWidgetData() -> WidgetDashboardData {
    guard let defaults = UserDefaults(suiteName: "group.com.autexa.mobile"),
          let json = defaults.string(forKey: "widget_dashboard_data"),
          let data = json.data(using: .utf8),
          let decoded = try? JSONDecoder().decode(WidgetDashboardData.self, from: data)
    else { return .placeholder }
    return decoded
}

// ── Timeline provider ────────────────────────────────────────────
struct AuTexaWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> AuTexaWidgetEntry {
        AuTexaWidgetEntry(date: Date(), data: .placeholder)
    }
    func getSnapshot(in context: Context, completion: @escaping (AuTexaWidgetEntry) -> Void) {
        completion(AuTexaWidgetEntry(date: Date(), data: loadWidgetData()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<AuTexaWidgetEntry>) -> Void) {
        let entry = AuTexaWidgetEntry(date: Date(), data: loadWidgetData())
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
    }
}

struct AuTexaWidgetEntry: TimelineEntry {
    let date: Date
    let data: WidgetDashboardData
}

// ── Number formatting ────────────────────────────────────────────
func formatMoney(_ value: Double) -> String {
    let n = Int(value)
    if n >= 1_000_000 {
        return String(format: "%.1fм ₽", Double(n) / 1_000_000)
    } else if n >= 1_000 {
        return String(format: "%.0fт ₽", Double(n) / 1_000)
    }
    return "\(n) ₽"
}

// ── Small widget view ────────────────────────────────────────────
struct SmallWidgetView: View {
    let entry: AuTexaWidgetEntry

    var body: some View {
        ZStack {
            // Background
            LinearGradient(
                colors: [Color(red: 0.09, green: 0.12, blue: 0.20), Color(red: 0.08, green: 0.10, blue: 0.16)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )

            VStack(alignment: .leading, spacing: 6) {
                // Header
                HStack {
                    Image(systemName: "car.fill")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(Color(red: 0.37, green: 0.55, blue: 0.98))
                    Text("Autexa")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(.white.opacity(0.7))
                    Spacer()
                    Circle()
                        .fill(entry.data.shiftOpen ? Color.green : Color.gray.opacity(0.5))
                        .frame(width: 6, height: 6)
                }

                Spacer()

                // Revenue hero
                Text(formatMoney(entry.data.revenue))
                    .font(.system(size: 22, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)

                Text("Выручка сегодня")
                    .font(.system(size: 9, weight: .medium))
                    .foregroundColor(.white.opacity(0.5))

                // Checks count
                HStack(spacing: 4) {
                    Image(systemName: "doc.text.fill")
                        .font(.system(size: 9))
                        .foregroundColor(Color(red: 0.37, green: 0.55, blue: 0.98).opacity(0.8))
                    Text("\(entry.data.checksCount) чеков")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.white.opacity(0.6))
                }
            }
            .padding(14)
        }
        .containerBackground(for: .widget) {
            Color(red: 0.09, green: 0.12, blue: 0.20)
        }
    }
}

// ── Medium widget view ───────────────────────────────────────────
struct MediumWidgetView: View {
    let entry: AuTexaWidgetEntry

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.09, green: 0.12, blue: 0.20), Color(red: 0.08, green: 0.10, blue: 0.16)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )

            HStack(spacing: 0) {
                // Left: revenue + checks
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: "car.fill")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundColor(Color(red: 0.37, green: 0.55, blue: 0.98))
                        Text("Autexa")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundColor(.white.opacity(0.7))
                        Spacer()
                        Circle()
                            .fill(entry.data.shiftOpen ? Color.green : Color.gray.opacity(0.5))
                            .frame(width: 7, height: 7)
                        Text(entry.data.shiftOpen ? "Смена открыта" : "Смена закрыта")
                            .font(.system(size: 9))
                            .foregroundColor(entry.data.shiftOpen ? Color.green.opacity(0.8) : Color.gray.opacity(0.5))
                    }

                    Spacer()

                    Text(formatMoney(entry.data.revenue))
                        .font(.system(size: 26, weight: .bold, design: .rounded))
                        .foregroundColor(.white)
                        .minimumScaleFactor(0.5)
                        .lineLimit(1)
                    Text("Выручка сегодня")
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.5))
                }
                .padding(.leading, 16)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)

                // Divider
                Rectangle()
                    .fill(Color.white.opacity(0.08))
                    .frame(width: 1)
                    .padding(.vertical, 12)

                // Right: profit + checks
                VStack(alignment: .leading, spacing: 12) {
                    MetricTile(
                        icon: "arrow.up.circle.fill",
                        iconColor: Color.green,
                        value: formatMoney(entry.data.profitToday),
                        label: "Прибыль"
                    )
                    MetricTile(
                        icon: "doc.text.fill",
                        iconColor: Color(red: 0.37, green: 0.55, blue: 0.98),
                        value: "\(entry.data.checksCount)",
                        label: "Чеков"
                    )
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .frame(maxWidth: .infinity)
            }
        }
        .containerBackground(for: .widget) {
            Color(red: 0.09, green: 0.12, blue: 0.20)
        }
    }
}

struct MetricTile: View {
    let icon: String
    let iconColor: Color
    let value: String
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 11))
                    .foregroundColor(iconColor)
                Text(value)
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundColor(.white)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            Text(label)
                .font(.system(size: 9))
                .foregroundColor(.white.opacity(0.5))
        }
    }
}

// ── Widget ───────────────────────────────────────────────────────
struct AuTexaWidget: Widget {
    let kind: String = "AuTexaWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AuTexaWidgetProvider()) { entry in
            AuTexaWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Autexa")
        .description("Выручка и чеки за сегодня")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct AuTexaWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: AuTexaWidgetEntry

    var body: some View {
        switch family {
        case .systemSmall:
            SmallWidgetView(entry: entry)
        case .systemMedium:
            MediumWidgetView(entry: entry)
        default:
            SmallWidgetView(entry: entry)
        }
    }
}
