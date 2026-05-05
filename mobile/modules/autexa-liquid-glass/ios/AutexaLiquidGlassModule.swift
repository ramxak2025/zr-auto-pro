import ExpoModulesCore

public class AutexaLiquidGlassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AutexaLiquidGlass")

    View(AutexaLiquidGlassView.self) {
      // Material variant: maps to UIBlurEffect.Style on iOS
      Prop("variant") { (view: AutexaLiquidGlassView, value: String) in
        view.applyVariant(value)
      }

      // Optional alpha multiplier for the effect (0..1). Default 1.0.
      Prop("intensity") { (view: AutexaLiquidGlassView, value: Double) in
        view.applyIntensity(CGFloat(value))
      }

      // Adds a 1px hairline highlight at the top edge — helps premium "glass dome" feel.
      Prop("topRim") { (view: AutexaLiquidGlassView, value: Bool) in
        view.setTopRim(visible: value)
      }
    }
  }
}
