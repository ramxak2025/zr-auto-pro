import Foundation

// Both the app and widget compile this source. The marker is generated into
// each target's own Info.plist; public App Group values are never migrated.
enum AutexaNativeEnvironment {
    static let internalMessage = "Внутренний тест · отдельная база"

    static func isInternal(_ info: [String: Any]?) -> Bool {
        info?["AutexaInventoryInternal"] as? Bool == true
    }

    static var inventoryInternal: Bool { isInternal(Bundle.main.infoDictionary) }

    static func publicDefaults(
        internalBuild: Bool = inventoryInternal,
        makeDefaults: () -> UserDefaults? = { UserDefaults(suiteName: "group.com.autexa.mobile") }
    ) -> UserDefaults? {
        guard !internalBuild else { return nil }
        return makeDefaults()
    }

    static func queuePendingAction(
        _ action: String,
        internalBuild: Bool = inventoryInternal,
        makeDefaults: () -> UserDefaults? = { UserDefaults(suiteName: "group.com.autexa.mobile") }
    ) {
        guard let defaults = publicDefaults(internalBuild: internalBuild, makeDefaults: makeDefaults) else { return }
        let payload: [String: Any] = [
            "action": action,
            "at": ISO8601DateFormatter().string(from: Date()),
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload),
           let json = String(data: data, encoding: .utf8) {
            defaults.set(json, forKey: "autexa_pending_intent")
        }
    }

    static func widgetSnapshot(
        internalBuild: Bool = inventoryInternal,
        makeDefaults: () -> UserDefaults? = { UserDefaults(suiteName: "group.com.autexa.mobile") }
    ) -> String? {
        publicDefaults(internalBuild: internalBuild, makeDefaults: makeDefaults)?.string(forKey: "widget_dashboard_data")
    }

    static func readTodayRevenue(
        internalBuild: Bool = inventoryInternal,
        makeDefaults: () -> UserDefaults? = { UserDefaults(suiteName: "group.com.autexa.mobile") }
    ) -> Double? {
        guard let json = widgetSnapshot(internalBuild: internalBuild, makeDefaults: makeDefaults),
              let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        if let n = obj["revenue"] as? NSNumber { return n.doubleValue }
        if let n = obj["earningsToday"] as? NSNumber { return n.doubleValue }
        return nil
    }
}

struct AutexaInternalIntentUnavailable: LocalizedError {
    var errorDescription: String? { AutexaNativeEnvironment.internalMessage }
}
