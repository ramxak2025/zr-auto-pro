import ExpoModulesCore
import UIKit
import WidgetKit

public class AutexaLiquidGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AutexaLiquidGlass")

    // Plain glass surface (used as a building block — for example, the
    // tab bar background, a sheet header, etc.)
    View(AutexaLiquidGlassView.self) {
      Prop("variant") { (view: AutexaLiquidGlassView, value: String) in
        view.applyVariant(value)
      }
      Prop("intensity") { (view: AutexaLiquidGlassView, value: Double) in
        view.applyIntensity(CGFloat(value))
      }
      Prop("topRim") { (view: AutexaLiquidGlassView, value: Bool) in
        view.setTopRim(visible: value)
      }
    }

    // Write today's dashboard snapshot into the shared App Group UserDefaults
    // so the AuTexaWidget WidgetKit extension can read it without a network
    // request. Immediately reloads all widget timelines so the Home Screen
    // reflects the new data within seconds.
    //
    // `json` must be a JSON string conforming to the WidgetDashboardData
    // struct in ios-extensions/AuTexaWidget/AuTexaWidget.swift:
    //   { revenue, checksCount, profitToday, shiftOpen, updatedAt }
    //
    // On any OS where WidgetKit is not available (iOS < 14) the write still
    // succeeds (UserDefaults) but reloadAllTimelines is a no-op.
    Function("setWidgetData") { (json: String) in
      if let defaults = UserDefaults(suiteName: "group.com.autexa.mobile") {
        defaults.set(json, forKey: "widget_dashboard_data")
        defaults.synchronize()
      }
      if #available(iOS 14.0, *) {
        WidgetCenter.shared.reloadAllTimelines()
      }
    }

    // Force the entire app's interface style. Called from JS whenever the
    // user toggles dark/light mode in the React Native context. This
    // makes `UIVisualEffectView`s using `.systemThinMaterial` and friends
    // re-render in the right tone (light glass for light mode, dark
    // glass for dark mode), and also fixes the SF-Symbol weight / vibrancy
    // tinting on every view that uses the system trait collection.
    //
    // We walk every connected scene's windows (iOS 13+ multi-scene model)
    // rather than the deprecated `UIApplication.shared.keyWindow`, so the
    // override applies even if the app is split-screened.
    Function("setAppearance") { (mode: String) in
      DispatchQueue.main.async {
        let style: UIUserInterfaceStyle
        switch mode {
        case "dark":
          style = .dark
        case "light":
          style = .light
        default:
          style = .unspecified
        }
        for scene in UIApplication.shared.connectedScenes {
          guard let windowScene = scene as? UIWindowScene else { continue }
          for window in windowScene.windows {
            window.overrideUserInterfaceStyle = style
          }
        }
      }
    }
  }
}

/**
 * Separate module for the tab-bar view so the JS lookup name lines up
 * unambiguously with `requireNativeViewManager('AutexaLiquidGlassTabBar')`.
 * Keeping it in its own Module avoids the multi-view ambiguity we hit when
 * two views were registered inside the same Module definition.
 */
public class AutexaLiquidGlassTabBarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AutexaLiquidGlassTabBar")

    View(AutexaLiquidGlassTabBarView.self) {
      Events("onTabPress")

      Prop("tabCount") { (view: AutexaLiquidGlassTabBarView, value: Int) in
        view.setTabCount(value)
      }
      Prop("activeIndex") { (view: AutexaLiquidGlassTabBarView, value: Int) in
        view.setActiveIndex(value)
      }
      Prop("bottomInset") { (view: AutexaLiquidGlassTabBarView, value: Double) in
        view.setBottomInset(CGFloat(value))
      }
    }
  }
}

/**
 * Premium native Касса button — see AutexaKassaButtonView.swift for the
 * full architecture (UIVisualEffectView + UIVibrancyEffect + SF Symbol +
 * UIImpactFeedbackGenerator + UISpringTimingParameters spring).
 *
 * Registered as its own Module so the JS lookup name
 * `requireNativeViewManager('AutexaKassaButton')` resolves cleanly,
 * matching the same pattern we use for the tab-bar view above.
 */
public class AutexaKassaButtonModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AutexaKassaButton")

    View(AutexaKassaButtonView.self) {
      Events("onPress")

      Prop("symbolName") { (view: AutexaKassaButtonView, value: String) in
        view.setSymbolName(value)
      }
      Prop("focused") { (view: AutexaKassaButtonView, value: Bool) in
        view.setFocused(value)
      }
    }
  }
}

/**
 * Native iOS schedule grid — replaces the synchronous-RN-ScrollView
 * implementation with a single UIScrollView that handles sticky header,
 * sticky names column, and cells natively. See AutexaScheduleGridView.swift
 * for the full architecture and JS-contract docs.
 */
public class AutexaScheduleGridModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AutexaScheduleGrid")

    View(AutexaScheduleGridView.self) {
      Events("onCellPress")

      Prop("usersJSON") { (view: AutexaScheduleGridView, value: String) in
        view.setUsersJSON(value)
      }
      Prop("entriesJSON") { (view: AutexaScheduleGridView, value: String) in
        view.setEntriesJSON(value)
      }
      Prop("dateFromISO") { (view: AutexaScheduleGridView, value: String) in
        // setDateRange requires both endpoints; we cache via prop pair
        view.setDateRange(from: value, to: view.cachedDateTo)
        view.cachedDateFrom = value
      }
      Prop("dateToISO") { (view: AutexaScheduleGridView, value: String) in
        view.setDateRange(from: view.cachedDateFrom, to: value)
        view.cachedDateTo = value
      }
      Prop("todayISO") { (view: AutexaScheduleGridView, value: String) in
        view.setToday(value)
      }
      Prop("cellWidth") { (view: AutexaScheduleGridView, value: Double) in
        view.setCellWidth(CGFloat(value))
      }
      Prop("rowHeight") { (view: AutexaScheduleGridView, value: Double) in
        view.setRowHeight(CGFloat(value))
      }
      Prop("nameColumnWidth") { (view: AutexaScheduleGridView, value: Double) in
        view.setNameColumnWidth(CGFloat(value))
      }
      Prop("headerHeight") { (view: AutexaScheduleGridView, value: Double) in
        view.setHeaderHeight(CGFloat(value))
      }
    }
  }
}
