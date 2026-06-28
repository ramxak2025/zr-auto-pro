import AppIntents
import Foundation

// ═══════════════════════════════════════════════════════════════════
//  AutexaAppIntents — Siri / Spotlight / Shortcuts (AppIntents, iOS 16+).
//
//  Compiled into the MAIN app target by plugins/withNativeCapabilities.js
//  (App Shortcuts must live in the app target to be discoverable by Siri /
//  Spotlight). AppIntents.framework is weak-linked there because the app
//  deploys to iOS 15.1 — every symbol below is @available(iOS 16.0, *), so
//  the weak link is never dereferenced before iOS 16.
//
//  Exposed actions (Russian, brand voice):
//    • «Создать заказ-наряд» — opens the app, queues a deep-link to Касса
//    • «Открыть кассу»       — opens the app, queues a deep-link to Касса
//    • «Выручка за сегодня»  — speaks today's revenue, no app launch
//
//  Data path: the open-app intents queue `{action, at}` JSON into the
//  shared App Group (`autexa_pending_intent`); the RN app reads + clears it
//  via AutexaLiquidGlass.consumePendingAppIntent(). «Выручка за сегодня»
//  reads the same snapshot the Home Screen widget reads
//  (`widget_dashboard_data`), so it works without launching the app.
// ═══════════════════════════════════════════════════════════════════

private let kAppGroup = "group.com.autexa.mobile"
private let kPendingKey = "autexa_pending_intent"
private let kSnapshotKey = "widget_dashboard_data"

@available(iOS 16.0, *)
private func queuePendingAction(_ action: String) {
    guard let defaults = UserDefaults(suiteName: kAppGroup) else { return }
    let payload: [String: Any] = [
        "action": action,
        "at": ISO8601DateFormatter().string(from: Date()),
    ]
    if let data = try? JSONSerialization.data(withJSONObject: payload),
       let json = String(data: data, encoding: .utf8) {
        defaults.set(json, forKey: kPendingKey)
    }
}

@available(iOS 16.0, *)
private func readTodayRevenue() -> Double? {
    guard let defaults = UserDefaults(suiteName: kAppGroup),
          let json = defaults.string(forKey: kSnapshotKey),
          let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return nil }
    // owner snapshot → revenue; master snapshot → earningsToday.
    if let n = obj["revenue"] as? NSNumber { return n.doubleValue }
    if let n = obj["earningsToday"] as? NSNumber { return n.doubleValue }
    return nil
}

@available(iOS 16.0, *)
private func formatRubForSiri(_ value: Double) -> String {
    let f = NumberFormatter()
    f.numberStyle = .decimal
    f.locale = Locale(identifier: "ru_RU")
    f.maximumFractionDigits = 0
    let s = f.string(from: NSNumber(value: value.rounded())) ?? "0"
    return "\(s) рублей"
}

// ── «Создать заказ-наряд» ───────────────────────────────────────────
@available(iOS 16.0, *)
struct CreateOrderIntent: AppIntent {
    static var title: LocalizedStringResource = "Создать заказ-наряд"
    static var description = IntentDescription("Открывает Autexa на экране кассы для нового заказ-наряда.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        queuePendingAction("create_order")
        return .result()
    }
}

// ── «Открыть кассу» ─────────────────────────────────────────────────
@available(iOS 16.0, *)
struct OpenCashIntent: AppIntent {
    static var title: LocalizedStringResource = "Открыть кассу"
    static var description = IntentDescription("Открывает кассу Autexa.")
    static var openAppWhenRun: Bool = true

    func perform() async throws -> some IntentResult {
        queuePendingAction("open_cash")
        return .result()
    }
}

// ── «Выручка за сегодня» (speaks the number, no app launch) ─────────
@available(iOS 16.0, *)
struct TodayRevenueIntent: AppIntent {
    static var title: LocalizedStringResource = "Выручка за сегодня"
    static var description = IntentDescription("Сообщает выручку автосервиса за сегодня.")
    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let revenue = readTodayRevenue() else {
            return .result(dialog: "Откройте Autexa и войдите, чтобы посмотреть выручку за сегодня.")
        }
        return .result(dialog: "Выручка за сегодня: \(formatRubForSiri(revenue)).")
    }
}

// ── App Shortcuts — surface in Siri / Spotlight / Shortcuts ─────────
@available(iOS 16.0, *)
struct AutexaShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CreateOrderIntent(),
            phrases: [
                "Создать заказ-наряд в \(.applicationName)",
                "Новый заказ-наряд в \(.applicationName)",
                "\(.applicationName) новый заказ",
            ],
            shortTitle: "Заказ-наряд",
            systemImageName: "plus.square.on.square"
        )
        AppShortcut(
            intent: OpenCashIntent(),
            phrases: [
                "Открыть кассу в \(.applicationName)",
                "\(.applicationName) касса",
            ],
            shortTitle: "Касса",
            systemImageName: "creditcard"
        )
        AppShortcut(
            intent: TodayRevenueIntent(),
            phrases: [
                "Выручка за сегодня в \(.applicationName)",
                "Сколько выручка в \(.applicationName)",
                "\(.applicationName) выручка за сегодня",
            ],
            shortTitle: "Выручка",
            systemImageName: "rublesign.circle"
        )
    }
}
