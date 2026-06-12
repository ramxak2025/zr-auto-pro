import WidgetKit
import SwiftUI

// ═══════════════════════════════════════════════════════════════════
//  AuTexaWidget — role-aware Home Screen widget.
//
//  The app writes a JSON payload into the shared App Group
//  (`group.com.autexa.mobile`, key `widget_dashboard_data`) via
//  AutexaLiquidGlassModule.setWidgetData(). Shape depends on role:
//
//    master → { role: "master", earningsToday, earningsMonth,
//               shiftOpen?, updatedAt }
//    owner  → { role: "owner", revenue, profitToday, checksCount,
//               updatedAt }
//
//  Legacy payloads (pre-role) carried { revenue, checksCount,
//  profitToday, shiftOpen } — every field below is optional so old
//  data decodes fine and falls into the owner layout.
//
//  Deployment target is iOS 17.0 (see plugins/withWidgetExtension.js),
//  so iOS 17 APIs (containerBackground) are used unconditionally.
// ═══════════════════════════════════════════════════════════════════

// ── Data model ──────────────────────────────────────────────────────
struct WidgetPayload: Codable {
    var role: String?

    // master
    var earningsToday: Double?
    var earningsMonth: Double?
    var shiftOpen: Bool?

    // owner
    var revenue: Double?
    var profitToday: Double?
    var checksCount: Int?

    var updatedAt: String?

    var isMaster: Bool { role == "master" }

    /// `role: "none"` is the logged-out sentinel written by
    /// `clearWidgetData()` (widgetBridge.ts) on logout / 401 / account
    /// switch. It must render the neutral empty state — NOT the owner
    /// layout with zeros, and never the previous session's numbers.
    var isCleared: Bool { role == "none" }

    /// Gallery / placeholder previews.
    static let ownerSample = WidgetPayload(
        role: "owner", revenue: 48_500, profitToday: 21_300, checksCount: 14,
        updatedAt: ISO8601DateFormatter().string(from: Date())
    )
    static let masterSample = WidgetPayload(
        role: "master", earningsToday: 6_400, earningsMonth: 84_200, shiftOpen: true,
        updatedAt: ISO8601DateFormatter().string(from: Date())
    )
}

func loadWidgetPayload() -> WidgetPayload? {
    guard let defaults = UserDefaults(suiteName: "group.com.autexa.mobile"),
          let json = defaults.string(forKey: "widget_dashboard_data"),
          let data = json.data(using: .utf8),
          let decoded = try? JSONDecoder().decode(WidgetPayload.self, from: data)
    else { return nil }
    return decoded
}

// ── Timeline provider ───────────────────────────────────────────────
struct AuTexaWidgetEntry: TimelineEntry {
    let date: Date
    let payload: WidgetPayload?
}

struct AuTexaWidgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> AuTexaWidgetEntry {
        // WidgetKit renders this entry with automatic placeholder
        // redaction — sample numbers become grey capsules.
        AuTexaWidgetEntry(date: Date(), payload: .ownerSample)
    }

    func getSnapshot(in context: Context, completion: @escaping (AuTexaWidgetEntry) -> Void) {
        // Widget gallery: show real data when the app has written some,
        // otherwise a polished sample so the preview never looks broken.
        // A cleared (logged-out) payload counts as "no data" for previews.
        let stored = loadWidgetPayload()
        let real = (stored?.isCleared == true) ? nil : stored
        let payload = real ?? (context.isPreview ? .ownerSample : nil)
        completion(AuTexaWidgetEntry(date: Date(), payload: payload))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AuTexaWidgetEntry>) -> Void) {
        let entry = AuTexaWidgetEntry(date: Date(), payload: loadWidgetPayload())
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
    }
}

// ── Formatting ──────────────────────────────────────────────────────
/// Brand blue #2563eb — matches `colors.primary[600]` in the RN theme.
let autexaBlue = Color(red: 0x25 / 255.0, green: 0x63 / 255.0, blue: 0xEB / 255.0)

private let rubFormatter: NumberFormatter = {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.locale = Locale(identifier: "ru_RU")
    f.maximumFractionDigits = 0
    return f
}()

/// "48 500 ₽" — ru_RU grouping (narrow no-break space), no decimals.
func formatRub(_ value: Double) -> String {
    let s = rubFormatter.string(from: NSNumber(value: value.rounded())) ?? "0"
    return "\(s) ₽"
}

/// "14 чеков" with correct Russian declension.
func checksLabel(_ n: Int) -> String {
    let mod10 = n % 10
    let mod100 = n % 100
    if mod10 == 1 && mod100 != 11 { return "\(n) чек" }
    if (2...4).contains(mod10) && !(12...14).contains(mod100) { return "\(n) чека" }
    return "\(n) чеков"
}

/// "обновлено 14:32" from the ISO string the app wrote, or nil.
func updatedLabel(_ iso: String?) -> String? {
    guard let iso, !iso.isEmpty else { return nil }
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    guard let date = withFraction.date(from: iso) ?? plain.date(from: iso) else { return nil }
    let f = DateFormatter()
    f.locale = Locale(identifier: "ru_RU")
    f.dateFormat = "HH:mm"
    return "обновлено \(f.string(from: date))"
}

// ── Shared building blocks ──────────────────────────────────────────
struct BrandHeader: View {
    var shiftOpen: Bool? = nil

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "car.fill")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(autexaBlue)
            Text("Autexa")
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.secondary)
            Spacer(minLength: 0)
            if let shiftOpen {
                Circle()
                    .fill(shiftOpen ? Color.green : Color(.systemGray3))
                    .frame(width: 7, height: 7)
            }
        }
    }
}

struct MoneyText: View {
    let value: Double
    var size: CGFloat = 26

    var body: some View {
        Text(formatRub(value))
            .font(.system(size: size, weight: .bold, design: .rounded))
            .foregroundStyle(.primary)
            .minimumScaleFactor(0.5)
            .lineLimit(1)
            .privacySensitive()
    }
}

struct CaptionLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(.secondary)
    }
}

struct UpdatedFootnote: View {
    let iso: String?

    var body: some View {
        if let label = updatedLabel(iso) {
            Text(label)
                .font(.system(size: 9))
                .foregroundStyle(.tertiary)
        }
    }
}

// ── Empty state — app installed but nobody logged in yet ───────────
struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 7) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(autexaBlue.opacity(0.12))
                    .frame(width: 38, height: 38)
                Image(systemName: "car.fill")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(autexaBlue)
            }
            Text("Откройте Autexa")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.primary)
            Text("Данные появятся после входа")
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// ── MASTER: «Мой заработок» ─────────────────────────────────────────
struct MasterSmallView: View {
    let payload: WidgetPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            BrandHeader(shiftOpen: payload.shiftOpen)
            Spacer(minLength: 2)
            MoneyText(value: payload.earningsToday ?? 0, size: 25)
            CaptionLabel(text: "Мой заработок сегодня")
            Spacer(minLength: 2)
            HStack(spacing: 4) {
                Image(systemName: "calendar")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(autexaBlue)
                Text("Месяц: \(formatRub(payload.earningsMonth ?? 0))")
                    .font(.system(size: 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.secondary)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                    .privacySensitive()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct MasterMediumView: View {
    let payload: WidgetPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                BrandHeader()
                if let shiftOpen = payload.shiftOpen {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(shiftOpen ? Color.green : Color(.systemGray3))
                            .frame(width: 6, height: 6)
                        Text(shiftOpen ? "Смена открыта" : "Смена закрыта")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(shiftOpen ? Color.green : Color.secondary)
                    }
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(
                        Capsule().fill(
                            shiftOpen ? Color.green.opacity(0.12) : Color(.systemGray5).opacity(0.6)
                        )
                    )
                }
            }

            Spacer(minLength: 4)

            HStack(alignment: .firstTextBaseline, spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    MoneyText(value: payload.earningsToday ?? 0, size: 30)
                    CaptionLabel(text: "Мой заработок сегодня")
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(formatRub(payload.earningsMonth ?? 0))
                        .font(.system(size: 18, weight: .semibold, design: .rounded))
                        .foregroundStyle(.primary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                        .privacySensitive()
                    CaptionLabel(text: "За месяц")
                }
            }

            Spacer(minLength: 4)

            UpdatedFootnote(iso: payload.updatedAt)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// ── OWNER: оборот + чистая прибыль ──────────────────────────────────
struct OwnerSmallView: View {
    let payload: WidgetPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            BrandHeader()
            Spacer(minLength: 2)
            MoneyText(value: payload.revenue ?? 0, size: 24)
            CaptionLabel(text: "Оборот сегодня")
            Spacer(minLength: 2)
            HStack(spacing: 4) {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.green)
                Text(formatRub(payload.profitToday ?? 0))
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.primary)
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
                    .privacySensitive()
                Text("прибыль")
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 4) {
                Image(systemName: "doc.text.fill")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(autexaBlue)
                Text(checksLabel(payload.checksCount ?? 0))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct OwnerMediumView: View {
    let payload: WidgetPayload

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                BrandHeader()
                UpdatedFootnote(iso: payload.updatedAt)
            }

            Spacer(minLength: 4)

            HStack(alignment: .top, spacing: 0) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("ОБОРОТ СЕГОДНЯ")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .kerning(0.4)
                    MoneyText(value: payload.revenue ?? 0, size: 26)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Rectangle()
                    .fill(Color(.separator).opacity(0.5))
                    .frame(width: 1)
                    .padding(.vertical, 2)
                    .padding(.horizontal, 12)

                VStack(alignment: .leading, spacing: 2) {
                    Text("ЧИСТАЯ ПРИБЫЛЬ")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .kerning(0.4)
                    HStack(spacing: 4) {
                        Image(systemName: "arrow.up.right")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundStyle(Color.green)
                        Text(formatRub(payload.profitToday ?? 0))
                            .font(.system(size: 22, weight: .bold, design: .rounded))
                            .foregroundStyle(.primary)
                            .minimumScaleFactor(0.5)
                            .lineLimit(1)
                            .privacySensitive()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Spacer(minLength: 4)

            HStack(spacing: 4) {
                Image(systemName: "doc.text.fill")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(autexaBlue)
                Text("\(checksLabel(payload.checksCount ?? 0)) за сегодня")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

// ── Widget ──────────────────────────────────────────────────────────
struct AuTexaWidgetEntryView: View {
    @Environment(\.widgetFamily) var family
    let entry: AuTexaWidgetEntry

    var body: some View {
        Group {
            if let payload = entry.payload, !payload.isCleared {
                if payload.isMaster {
                    if family == .systemMedium {
                        MasterMediumView(payload: payload)
                    } else {
                        MasterSmallView(payload: payload)
                    }
                } else {
                    if family == .systemMedium {
                        OwnerMediumView(payload: payload)
                    } else {
                        OwnerSmallView(payload: payload)
                    }
                }
            } else {
                EmptyStateView()
            }
        }
        // System background adapts to light/dark automatically; the
        // tinted/clear Home Screen modes get .fill.tertiary treatment
        // from the system. No hardcoded whites anywhere.
        .containerBackground(for: .widget) {
            Color(.systemBackground)
        }
    }
}

struct AuTexaWidget: Widget {
    let kind: String = "AuTexaWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: AuTexaWidgetProvider()) { entry in
            AuTexaWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Autexa")
        .description("Заработок мастера или оборот и прибыль сервиса за сегодня")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
