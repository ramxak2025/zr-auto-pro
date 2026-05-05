import ExpoModulesCore
import UIKit

/**
 * AutexaLiquidGlassView
 * --------------------------------------------------------------------------
 * Premium native iOS glass surface for the Autexa tab bar.
 *
 * Material strategy (PRIMARY → FALLBACK):
 *
 *   1. iOS 26+: try Apple's new UIGlassEffect (true Liquid Glass with subtle
 *      live distortion). The class is referenced via the Objective-C runtime
 *      so the module compiles on any Xcode SDK — if the symbol exists at
 *      runtime, we use it. This is THE primary path on devices that support
 *      it (iPhone 17 Pro on iOS 26.x is in this group).
 *
 *   2. iOS 13–25 (and any device where UIGlassEffect can't be instantiated):
 *      fall back to UIVisualEffectView with UIBlurEffect.systemThinMaterial —
 *      Apple's standard premium glass material (Control Center, Notification
 *      Center, Apple Music mini-player, Wallet sheets all use it).
 *
 * On top of the native effect we layer two purely cosmetic touches:
 *   • a vertical white-to-translucent gradient (CAGradientLayer) that sells
 *     the "dome" feel — light enters from the top edge.
 *   • a 1pt white hairline at the very top — stands in for the highlight that
 *     real glass would refract off its rim.
 *
 * RN children (icons, labels) are inserted by React on top of all of the
 * above by ordering — they read crisply over the material.
 */
public class AutexaLiquidGlassView: ExpoView {

  private let effectView: UIVisualEffectView
  private let highlightLayer: CAGradientLayer
  private let topRimView: UIView
  private var topRimVisible: Bool = true

  public required init(appContext: AppContext? = nil) {
    // Start with the strongest available material as the seed; we'll upgrade
    // to UIGlassEffect below if iOS 26+ supports it.
    let seedEffect: UIVisualEffect = {
      if #available(iOS 13.0, *) {
        return UIBlurEffect(style: .systemThinMaterial)
      } else {
        return UIBlurEffect(style: .light)
      }
    }()
    self.effectView = UIVisualEffectView(effect: seedEffect)

    self.highlightLayer = CAGradientLayer()
    self.highlightLayer.colors = [
      UIColor(white: 1.0, alpha: 0.42).cgColor,
      UIColor(white: 1.0, alpha: 0.10).cgColor,
      UIColor(white: 1.0, alpha: 0.20).cgColor,
    ]
    self.highlightLayer.locations = [0.0, 0.5, 1.0]
    self.highlightLayer.startPoint = CGPoint(x: 0.5, y: 0.0)
    self.highlightLayer.endPoint = CGPoint(x: 0.5, y: 1.0)

    self.topRimView = UIView()
    self.topRimView.backgroundColor = UIColor(white: 1.0, alpha: 0.78)

    super.init(appContext: appContext)

    // 1. effect view fills the bounds
    addSubview(effectView)
    effectView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      effectView.topAnchor.constraint(equalTo: topAnchor),
      effectView.bottomAnchor.constraint(equalTo: bottomAnchor),
      effectView.leadingAnchor.constraint(equalTo: leadingAnchor),
      effectView.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])

    // 2. gradient highlight (purely decorative)
    layer.addSublayer(highlightLayer)

    // 3. top hairline
    addSubview(topRimView)
    topRimView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      topRimView.topAnchor.constraint(equalTo: topAnchor),
      topRimView.leadingAnchor.constraint(equalTo: leadingAnchor),
      topRimView.trailingAnchor.constraint(equalTo: trailingAnchor),
      topRimView.heightAnchor.constraint(equalToConstant: 1.0 / UIScreen.main.scale),
    ])

    // 4. PRIMARY: try iOS 26 UIGlassEffect (real Liquid Glass)
    upgradeToGlassIfAvailable()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    highlightLayer.frame = bounds
    if highlightLayer.zPosition >= 0 {
      highlightLayer.zPosition = -1
    }
    bringSubviewToFront(topRimView)
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
    // After updating the fallback, re-attempt the iOS 26 upgrade.
    upgradeToGlassIfAvailable()
  }

  func applyIntensity(_ intensity: CGFloat) {
    effectView.alpha = max(0.0, min(1.0, intensity))
  }

  func setTopRim(visible: Bool) {
    topRimVisible = visible
    topRimView.isHidden = !visible
  }

  // MARK: - iOS 26 UIGlassEffect upgrade

  /**
   * Apple's UIGlassEffect ships in iOS 26 as a UIVisualEffect subclass that
   * produces real Liquid Glass — subtle live refraction over background
   * content, not a frosted blur.
   *
   * Because Xcode SDKs older than iOS 26 don't know the symbol, we don't
   * import it directly. Instead we look it up via the Objective-C runtime:
   *
   *   - on iOS 26+ the class is present and `init()` returns a valid instance
   *   - on iOS < 26 NSClassFromString returns nil and we silently keep the
   *     systemThinMaterial fallback
   *
   * This pattern compiles on any Xcode SDK and "lights up" automatically as
   * users move to iOS 26.
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
    // else: pre-iOS-26, nothing to do — UIBlurEffect.systemThinMaterial is the best material
  }
}
