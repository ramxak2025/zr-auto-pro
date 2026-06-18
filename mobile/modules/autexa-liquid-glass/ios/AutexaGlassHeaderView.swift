import ExpoModulesCore
import UIKit

/**
 * AutexaGlassHeaderView
 * --------------------------------------------------------------------------
 * Premium native iOS glass MATERIAL for a screen header / filter-chip strip
 * (currently the Journal screen's warehouse-docs kind-chip row in
 * `mobile/src/screens/ChecksScreen.tsx`).
 *
 * This is the sibling of `AutexaLiquidGlassView` (tab-bar glass) and reuses
 * the exact same material strategy, but is tuned for a HEADER that sits at
 * the TOP of the screen with content scrolling BELOW it:
 *
 *   • the decorative highlight reads from the top edge (light enters there),
 *   • the optional 1pt hairline is at the BOTTOM edge (the separator between
 *     the glass header and the scrolling list), not the top.
 *
 * Material strategy (PRIMARY → FALLBACK) — identical to the tab bar so the
 * whole app shares one glass language:
 *
 *   1. iOS 26+: Apple's UIGlassEffect (true Liquid Glass) via Obj-C runtime
 *      lookup (NSClassFromString) so the module compiles on any Xcode SDK.
 *   2. iOS 13–25: UIVisualEffectView + UIBlurEffect.systemThinMaterial.
 *   3. iOS < 13: UIBlurEffect.light.
 *
 * IMPORTANT — this view renders ONLY the glass material + decoration. The
 * filter chips themselves stay in React Native (they are the source of
 * truth for the kind/label/colour filter logic, and drive the same
 * `warehouseKind` state + `journalApi.warehouseDocs({type})` query). React
 * appends the RN chip row as a child on top of this material by subview
 * ordering — so the data flow is never forked into Swift, and the JS
 * fallback (Android / module missing / iOS<lookup-fails) renders the SAME
 * chips byte-for-byte over a transparent passthrough View.
 *
 * Why a separate Module/View instead of reusing AutexaLiquidGlassView:
 *   - AutexaLiquidGlassView hard-codes a TOP rim hairline (correct for the
 *     floating tab bar, wrong for a top-of-screen header), and exposes only
 *     `variant` / `topRim` props. Forking it would have meant overloading
 *     `topRim` with a meaning it doesn't have. A purpose-built header view
 *     keeps both components honest and easy to read.
 */
public class AutexaGlassHeaderView: ExpoView {

  private let effectView: UIVisualEffectView
  private let highlightLayer: CAGradientLayer
  private let bottomHairline: UIView
  private var bottomHairlineVisible: Bool = true

  public required init(appContext: AppContext? = nil) {
    // Seed with the strongest standard material; upgraded to UIGlassEffect
    // below if the device runs iOS 26+.
    let seedEffect: UIVisualEffect = {
      if #available(iOS 13.0, *) {
        return UIBlurEffect(style: .systemThinMaterial)
      } else {
        return UIBlurEffect(style: .light)
      }
    }()
    self.effectView = UIVisualEffectView(effect: seedEffect)

    // Decorative top-edge highlight — light enters from the top, exactly
    // like the tab-bar glass, but oriented for a header (brightest at the
    // top, settling toward the bottom edge).
    self.highlightLayer = CAGradientLayer()
    self.highlightLayer.colors = [
      UIColor(white: 1.0, alpha: 0.34).cgColor,
      UIColor(white: 1.0, alpha: 0.08).cgColor,
      UIColor(white: 1.0, alpha: 0.0).cgColor,
    ]
    self.highlightLayer.locations = [0.0, 0.55, 1.0]
    self.highlightLayer.startPoint = CGPoint(x: 0.5, y: 0.0)
    self.highlightLayer.endPoint = CGPoint(x: 0.5, y: 1.0)

    // Bottom hairline — the separator between the glass header and the list
    // that scrolls underneath. Subtle so it reads as a glass rim, not a
    // hard divider. Hidden by default (`bottomRim` prop defaults to false
    // on the JS side) so it never appears unless explicitly requested.
    self.bottomHairline = UIView()
    self.bottomHairline.backgroundColor = UIColor(white: 1.0, alpha: 0.55)
    self.bottomHairline.isUserInteractionEnabled = false
    self.bottomHairline.isHidden = true

    super.init(appContext: appContext)

    // The header glass must NOT swallow touches meant for the RN chips that
    // sit on top of it — the effect view and its decoration are purely
    // visual. React's chip TouchableOpacity children are added to `self`
    // and remain fully interactive because these subviews opt out.
    effectView.isUserInteractionEnabled = false

    // 1. effect view fills bounds
    addSubview(effectView)
    effectView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      effectView.topAnchor.constraint(equalTo: topAnchor),
      effectView.bottomAnchor.constraint(equalTo: bottomAnchor),
      effectView.leadingAnchor.constraint(equalTo: leadingAnchor),
      effectView.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])

    // 2. gradient highlight lives in the effect view's contentView so it
    //    renders ABOVE the material but BELOW the RN chip children React
    //    appends to `self`. (Same ordering lesson as AutexaLiquidGlassView:
    //    a sublayer of `self.layer` would render UNDER the effect view.)
    effectView.contentView.layer.addSublayer(highlightLayer)

    // 3. bottom hairline (added to self so it sits above the effect view)
    addSubview(bottomHairline)
    bottomHairline.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      bottomHairline.bottomAnchor.constraint(equalTo: bottomAnchor),
      bottomHairline.leadingAnchor.constraint(equalTo: leadingAnchor),
      bottomHairline.trailingAnchor.constraint(equalTo: trailingAnchor),
      bottomHairline.heightAnchor.constraint(equalToConstant: 1.0 / UIScreen.main.scale),
    ])

    // 4. PRIMARY: try iOS 26 UIGlassEffect (real Liquid Glass)
    upgradeToGlassIfAvailable()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    highlightLayer.frame = effectView.contentView.bounds
    bringSubviewToFront(bottomHairline)
  }

  // MARK: - Public API exposed to JS via the Module file

  func applyVariant(_ variant: String) {
    let style: UIBlurEffect.Style
    if #available(iOS 13.0, *) {
      switch variant {
      case "ultraThinMaterial": style = .systemUltraThinMaterial
      case "thinMaterial":      style = .systemThinMaterial
      case "material":          style = .systemMaterial
      case "thickMaterial":     style = .systemThickMaterial
      case "chromeMaterial":    style = .systemChromeMaterial
      default:                  style = .systemThinMaterial
      }
    } else {
      switch variant {
      case "thickMaterial": style = .regular
      default:              style = .light
      }
    }
    effectView.effect = UIBlurEffect(style: style)
    // After updating the fallback material, re-attempt the iOS 26 upgrade.
    upgradeToGlassIfAvailable()
  }

  func setBottomRim(visible: Bool) {
    bottomHairlineVisible = visible
    bottomHairline.isHidden = !visible
  }

  // MARK: - iOS 26 UIGlassEffect upgrade

  /**
   * Identical runtime-lookup strategy to AutexaLiquidGlassView: on iOS 26+
   * the `UIGlassEffect` class exists and we swap it in for true Liquid
   * Glass; on older iOS NSClassFromString returns nil and we keep the
   * systemThinMaterial fallback. Compiles on every Xcode SDK.
   */
  private func upgradeToGlassIfAvailable() {
    if #available(iOS 26.0, *) {
      guard let cls = NSClassFromString("UIGlassEffect") as? NSObject.Type else {
        return // SDK predates iOS 26 — keep UIBlurEffect fallback
      }
      let instance = cls.init()
      if let glass = instance as? UIVisualEffect {
        effectView.effect = glass
      }
    }
    // else: pre-iOS-26, nothing to do — systemThinMaterial is the best material
  }
}
