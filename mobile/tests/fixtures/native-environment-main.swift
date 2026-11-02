import Foundation

@main
struct NativeIsolationChecks {
    static func main() throws {
        precondition(!AutexaNativeEnvironment.isInternal(nil))
        precondition(!AutexaNativeEnvironment.isInternal([:]))
        precondition(!AutexaNativeEnvironment.isInternal(["AutexaInventoryInternal": false]))
        precondition(AutexaNativeEnvironment.isInternal(["AutexaInventoryInternal": true]))
        let suite = "autexa-isolation-test-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let snapshot = "{\"role\":\"owner\",\"revenue\":98765}"
        defaults.set(snapshot, forKey: "widget_dashboard_data")
        defaults.set("production-pending-action", forKey: "autexa_pending_intent")
        var accessCount = 0
        let factory: () -> UserDefaults? = { accessCount += 1; return defaults }
        AutexaNativeEnvironment.queuePendingAction("create_order", internalBuild: true, makeDefaults: factory)
        precondition(AutexaNativeEnvironment.readTodayRevenue(internalBuild: true, makeDefaults: factory) == nil)
        precondition(AutexaNativeEnvironment.widgetSnapshot(internalBuild: true, makeDefaults: factory) == nil)
        precondition(accessCount == 0, "Internal native paths opened the public App Group")
        precondition(defaults.string(forKey: "autexa_pending_intent") == "production-pending-action")
        precondition(defaults.string(forKey: "widget_dashboard_data") == snapshot)
        precondition(AutexaNativeEnvironment.readTodayRevenue(internalBuild: false, makeDefaults: factory) == 98765)
        precondition(AutexaNativeEnvironment.widgetSnapshot(internalBuild: false, makeDefaults: factory) == snapshot)
        AutexaNativeEnvironment.queuePendingAction("open_cash", internalBuild: false, makeDefaults: factory)
        let pending = defaults.string(forKey: "autexa_pending_intent")!.data(using: .utf8)!
        let decoded = try JSONSerialization.jsonObject(with: pending) as! [String: Any]
        precondition(decoded["action"] as? String == "open_cash")
        print("PASS native isolation: no internal shared-group access; public queue/revenue/widget behavior preserved")
    }
}
