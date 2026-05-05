import ExpoModulesCore

public class AutexaLiquidGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AutexaLiquidGlass")

    // ──────────────────────────────────────────────────────────────────────
    // 1. Plain glass surface (used as a building block — for example, the
    //    tab bar background, a sheet header, etc.)
    // ──────────────────────────────────────────────────────────────────────
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

    // ──────────────────────────────────────────────────────────────────────
    // 2. Liquid Glass tab bar — premium native iOS tab bar with an
    //    animated "droplet" highlight that springs between tabs and follows
    //    a pan gesture. Sits underneath the JS-rendered icons and labels.
    // ──────────────────────────────────────────────────────────────────────
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
