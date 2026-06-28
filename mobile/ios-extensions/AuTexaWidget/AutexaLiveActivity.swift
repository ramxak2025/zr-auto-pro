import ActivityKit
import WidgetKit
import SwiftUI

// ═══════════════════════════════════════════════════════════════════
//  AutexaLiveActivity — ActivityKit Live Activity (iOS 16.1+).
//
//  Renders an "active context" live on the Lock Screen and in the
//  Dynamic Island:
//    • kind == "order" → активный заказ-наряд в работе
//    • kind == "shift" → открытая кассовая смена
//
//  The RN app drives it through the `AutexaLiveActivity` Expo module
//  (modules/autexa-liquid-glass/ios/AutexaLiveActivityModule.swift):
//  start / update / end. ActivityKit reconstructs the activity here by
//  the type NAME + Codable shape, so `AutexaActivityAttributes` below is
//  byte-identical to the copy in that module. Keep them in sync.
//
//  This widget-extension target deploys to iOS 17.0, so 16.1 ActivityKit
//  symbols are always available; the @available annotations exist only so
//  the type matches the app side and reads cleanly.
// ═══════════════════════════════════════════════════════════════════

@available(iOS 16.1, *)
struct AutexaActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Primary line — госномер / "Заказ-наряд №…" / "Кассовая смена".
        var title: String
        /// Status line — "В работе", "Ожидает оплаты", "Касса открыта".
        var status: String
        /// Optional secondary line — мастер / клиент / позиций.
        var subtitle: String?
        /// Текущая сумма, ₽ (optional).
        var amount: Double?
        /// Позиций в заказе (optional).
        var itemsCount: Int?
        /// ISO-8601 start instant — drives the live elapsed timer.
        var startedAt: String?
    }

    /// "order" | "shift".
    var kind: String
    /// Backing order/shift id (opaque to the widget).
    var orderId: String?
}

// ── Helpers (own names so they never clash with AuTexaWidget.swift) ──
@available(iOS 16.1, *)
private func laStartDate(_ iso: String?) -> Date? {
    guard let iso, !iso.isEmpty else { return nil }
    let withFraction = ISO8601DateFormatter()
    withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return withFraction.date(from: iso) ?? plain.date(from: iso)
}

@available(iOS 16.1, *)
private func laIcon(_ kind: String) -> String {
    kind == "shift" ? "banknote.fill" : "wrench.and.screwdriver.fill"
}

// ── Lock-screen / banner presentation ───────────────────────────────
@available(iOS 16.1, *)
struct AutexaLiveActivityLockScreen: View {
    let context: ActivityViewContext<AutexaActivityAttributes>

    var body: some View {
        let state = context.state
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(autexaBlue.opacity(0.15))
                    .frame(width: 46, height: 46)
                Image(systemName: laIcon(context.attributes.kind))
                    .font(.system(size: 20, weight: .semibold))
                    .foregroundStyle(autexaBlue)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(state.title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.primary)
                    .lineLimit(1)
                Text(state.status)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(autexaBlue)
                    .lineLimit(1)
                if let sub = state.subtitle, !sub.isEmpty {
                    Text(sub)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 3) {
                if let amount = state.amount {
                    Text(formatRub(amount))
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(.primary)
                        .privacySensitive()
                }
                if let start = laStartDate(state.startedAt) {
                    Text(start, style: .timer)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 70, alignment: .trailing)
                }
            }
        }
        .padding(16)
        .activityBackgroundTint(Color(.systemBackground))
        .activitySystemActionForegroundColor(autexaBlue)
    }
}

// ── Widget (Live Activity configuration + Dynamic Island) ───────────
@available(iOS 16.1, *)
struct AutexaLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: AutexaActivityAttributes.self) { context in
            AutexaLiveActivityLockScreen(context: context)
        } dynamicIsland: { context in
            let state = context.state
            let kind = context.attributes.kind
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(state.title)
                            .font(.system(size: 13, weight: .semibold))
                            .lineLimit(1)
                    } icon: {
                        Image(systemName: laIcon(kind))
                            .foregroundStyle(autexaBlue)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if let amount = state.amount {
                        Text(formatRub(amount))
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(.primary)
                            .privacySensitive()
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(state.status)
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 6) {
                        if let sub = state.subtitle, !sub.isEmpty {
                            Text(sub)
                                .font(.system(size: 11))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 4)
                        if let start = laStartDate(state.startedAt) {
                            Label {
                                Text(start, style: .timer)
                                    .monospacedDigit()
                                    .frame(maxWidth: 58, alignment: .trailing)
                            } icon: {
                                Image(systemName: "timer")
                            }
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(autexaBlue)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: laIcon(kind))
                    .foregroundStyle(autexaBlue)
            } compactTrailing: {
                if let start = laStartDate(state.startedAt) {
                    Text(start, style: .timer)
                        .monospacedDigit()
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(autexaBlue)
                        .frame(maxWidth: 44)
                } else if let amount = state.amount {
                    Text(formatRub(amount))
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                        .foregroundStyle(.primary)
                }
            } minimal: {
                Image(systemName: laIcon(kind))
                    .foregroundStyle(autexaBlue)
            }
            .keylineTint(autexaBlue)
        }
    }
}
