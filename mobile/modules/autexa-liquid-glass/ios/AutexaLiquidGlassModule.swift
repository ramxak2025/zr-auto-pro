import ExpoModulesCore

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
