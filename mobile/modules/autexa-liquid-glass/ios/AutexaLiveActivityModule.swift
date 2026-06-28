import ExpoModulesCore
import Foundation
import ActivityKit

// ═══════════════════════════════════════════════════════════════════
//  AutexaLiveActivityModule — JS bridge to ActivityKit (iOS 16.1+).
//
//  start  → Activity.request(...)  returns the activity id
//  update → Activity.update(...)   by id
//  end    → Activity.end(...)      by id, optional final content
//
//  Below iOS 16.1 every function is a safe no-op (start returns nil).
//  On Android the JS wrapper never reaches native (Platform guard).
//
//  `AutexaActivityAttributes` is byte-identical to the copy rendered by
//  the widget extension (ios-extensions/AuTexaWidget/AutexaLiveActivity.swift):
//  ActivityKit matches the activity by the type NAME + Codable shape, so
//  this app-side copy requests it and the extension copy draws it.
//
//  NOTE on linking: this pod deploys to iOS 15.1, so ActivityKit is
//  weak-linked into the app binary by plugins/withNativeCapabilities.js
//  (-weak_framework ActivityKit). Without that, an iOS-15 device would
//  crash at launch on the missing dylib. All symbols are availability-
//  guarded, so the weak link is never dereferenced before iOS 16.1.
// ═══════════════════════════════════════════════════════════════════

@available(iOS 16.1, *)
struct AutexaActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var title: String
        var status: String
        var subtitle: String?
        var amount: Double?
        var itemsCount: Int?
        var startedAt: String?
    }

    var kind: String
    var orderId: String?
}

public class AutexaLiveActivityModule: Module {
    public func definition() -> ModuleDefinition {
        Name("AutexaLiveActivity")

        // Are Live Activities supported AND enabled by the user?
        Function("isSupported") { () -> Bool in
            if #available(iOS 16.1, *) {
                return ActivityAuthorizationInfo().areActivitiesEnabled
            }
            return false
        }

        // Start an activity. Returns the activity id (use it for update/end)
        // or nil on unsupported OS / disabled / failure.
        AsyncFunction("start") { (attributesJson: String, contentJson: String) -> String? in
            if #available(iOS 16.1, *) {
                return AutexaLiveActivityModule.startActivity(
                    attributesJson: attributesJson, contentJson: contentJson
                )
            }
            return nil
        }

        AsyncFunction("update") { (id: String, contentJson: String) -> Void in
            if #available(iOS 16.1, *) {
                await AutexaLiveActivityModule.updateActivity(id: id, contentJson: contentJson)
            }
        }

        AsyncFunction("end") { (id: String, contentJson: String?, dismissImmediately: Bool) -> Void in
            if #available(iOS 16.1, *) {
                await AutexaLiveActivityModule.endActivity(
                    id: id, contentJson: contentJson, dismissImmediately: dismissImmediately
                )
            }
        }

        AsyncFunction("endAll") { () -> Void in
            if #available(iOS 16.1, *) {
                await AutexaLiveActivityModule.endAll()
            }
        }
    }
}

// ── ActivityKit plumbing (availability-gated) ───────────────────────
@available(iOS 16.1, *)
extension AutexaLiveActivityModule {
    static func startActivity(attributesJson: String, contentJson: String) -> String? {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }
        let decoder = JSONDecoder()
        guard
            let attrs = try? decoder.decode(AutexaActivityAttributes.self, from: Data(attributesJson.utf8)),
            let state = try? decoder.decode(AutexaActivityAttributes.ContentState.self, from: Data(contentJson.utf8))
        else { return nil }

        do {
            if #available(iOS 16.2, *) {
                let content = ActivityContent(state: state, staleDate: nil)
                let activity = try Activity.request(attributes: attrs, content: content, pushType: nil)
                return activity.id
            } else {
                let activity = try Activity.request(attributes: attrs, contentState: state, pushType: nil)
                return activity.id
            }
        } catch {
            return nil
        }
    }

    static func updateActivity(id: String, contentJson: String) async {
        guard
            let state = try? JSONDecoder().decode(
                AutexaActivityAttributes.ContentState.self, from: Data(contentJson.utf8)
            )
        else { return }
        for activity in Activity<AutexaActivityAttributes>.activities where activity.id == id {
            if #available(iOS 16.2, *) {
                await activity.update(ActivityContent(state: state, staleDate: nil))
            } else {
                await activity.update(using: state)
            }
        }
    }

    static func endActivity(id: String, contentJson: String?, dismissImmediately: Bool) async {
        let policy: ActivityUIDismissalPolicy = dismissImmediately ? .immediate : .default
        let finalState: AutexaActivityAttributes.ContentState? = contentJson.flatMap {
            try? JSONDecoder().decode(AutexaActivityAttributes.ContentState.self, from: Data($0.utf8))
        }
        for activity in Activity<AutexaActivityAttributes>.activities where activity.id == id {
            if #available(iOS 16.2, *) {
                let content = finalState.map { ActivityContent(state: $0, staleDate: nil) }
                await activity.end(content, dismissalPolicy: policy)
            } else {
                await activity.end(using: finalState, dismissalPolicy: policy)
            }
        }
    }

    static func endAll() async {
        for activity in Activity<AutexaActivityAttributes>.activities {
            if #available(iOS 16.2, *) {
                await activity.end(nil, dismissalPolicy: .immediate)
            } else {
                await activity.end(using: nil, dismissalPolicy: .immediate)
            }
        }
    }
}
