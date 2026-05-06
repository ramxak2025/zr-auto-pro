import ExpoModulesCore
import UIKit

/**
 * AutexaKassaButtonView — premium centre CTA, version 4.
 * --------------------------------------------------------------------------
 * Iter#4 brings firm-gradient Касса that owner asked for ("в фирменных
 * градиентных цветах, но это должно выглядеть вкусно, современно и
 * по-iOS, без колхоза"). The button now layers:
 *
 *   1. UIVisualEffectView (systemChromeMaterial) — base glass material
 *   2. CAGradientLayer (primary-500 → primary-700 diagonal) at alpha 0.92
 *      ON TOP of the glass — gives the firm tinted color while preserving
 *      the glass material's depth response (same trick Apple uses on
 *      iOS 26 Music Now-Playing's primary action).
 *   3. SF Symbol in WHITE on top — vibrant white reads cleanly against
 *      the saturated gradient.
 *
 * The button still feels like part of the bar (continuous-corner squircle,
 * matching rim, similar shadow) but now visually IS the primary action,
 * not an undifferentiated slot.
 *
 * Geometry (52×52pt):
 *   • Continuous-corner squircle, radius 18pt — slightly more rounded
 *     than iter#2 (16pt) so it merges into the pill bar rather than
 *     reading as a separate rectangle.
 *   • Subtle 1-pt rim with 70% white — single hairline highlight,
 *     same as the bar's own border, so the button feels carved from
 *     the same glass.
 *   • Drop shadow only on the surface itself — soft, neutral black,
 *     not primary-tinted. Smaller than iter#2 (radius 6, opacity 0.10).
 *
 * Material:
 *   • UIVisualEffectView with systemChromeMaterial — slightly thicker
 *     than the bar's systemThinMaterial so the button visually "lifts"
 *     above the bar surface without a separate paint colour.
 *   • UIVibrancyEffect (.fill style) — gives the SF Symbol the proper
 *     "glass-tinted" feel; no flat-colour symbol on top of glass.
 *   • iOS 26+ → runtime-upgraded to UIGlassEffect (real refraction).
 *
 * Touch / haptics / animation: same as before — subtle scale-down on
 * touchesBegan, spring back on release, medium impact haptic.
 */
public class AutexaKassaButtonView: ExpoView {

  // MARK: - Subviews

  private let surfaceView = UIView()
  private let effectView: UIVisualEffectView
  private let gradientLayer = CAGradientLayer()
  private let symbolImageView = UIImageView()
  private let impactFeedback = UIImpactFeedbackGenerator(style: .medium)

  // MARK: - Props

  private var symbolName: String = "bag.fill"
  private var kassaFocused: Bool = false

  // MARK: - Events

  let onPress = EventDispatcher()

  // MARK: - Init

  public required init(appContext: AppContext? = nil) {
    let baseEffect: UIVisualEffect = {
      if #available(iOS 13.0, *) {
        return UIBlurEffect(style: .systemChromeMaterial)
      } else {
        return UIBlurEffect(style: .light)
      }
    }()
    self.effectView = UIVisualEffectView(effect: baseEffect)

    super.init(appContext: appContext)

    backgroundColor = .clear
    isUserInteractionEnabled = true

    // Surface — the actual visible button. Continuous-corner squircle,
    // slightly higher radius so the button reads as carved from the bar
    // pill itself, not a foreign rectangle.
    surfaceView.layer.cornerCurve = .continuous
    surfaceView.layer.cornerRadius = 18
    surfaceView.clipsToBounds = true
    surfaceView.layer.borderWidth = 1.0 / UIScreen.main.scale
    surfaceView.layer.borderColor = UIColor.white.withAlphaComponent(0.65).cgColor
    addSubview(surfaceView)

    // Drop shadow — primary-tinted very softly so the glow reads as
    // "this is the brand action" without going neon.
    layer.shadowColor = UIColor(red: 0.118, green: 0.227, blue: 0.541, alpha: 1.0).cgColor // primary-800
    layer.shadowOpacity = 0.22
    layer.shadowRadius = 10
    layer.shadowOffset = CGSize(width: 0, height: 4)

    // Glass material fills the surface
    surfaceView.addSubview(effectView)
    effectView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      effectView.topAnchor.constraint(equalTo: surfaceView.topAnchor),
      effectView.bottomAnchor.constraint(equalTo: surfaceView.bottomAnchor),
      effectView.leadingAnchor.constraint(equalTo: surfaceView.leadingAnchor),
      effectView.trailingAnchor.constraint(equalTo: surfaceView.trailingAnchor),
    ])

    // Brand gradient ON TOP of the glass — diagonal primary-500 →
    // primary-700, alpha tuned so the underlying material still
    // breathes through (the press-down animation on glass shows under
    // the gradient, keeping the "alive" glass feel).
    let primary500 = UIColor(red: 0.231, green: 0.510, blue: 0.965, alpha: 1.0).cgColor
    let primary600 = UIColor(red: 0.149, green: 0.388, blue: 0.922, alpha: 1.0).cgColor
    let primary700 = UIColor(red: 0.114, green: 0.306, blue: 0.847, alpha: 1.0).cgColor
    gradientLayer.colors = [primary500, primary600, primary700]
    gradientLayer.locations = [0.0, 0.5, 1.0]
    gradientLayer.startPoint = CGPoint(x: 0.0, y: 0.0)
    gradientLayer.endPoint = CGPoint(x: 1.0, y: 1.0)
    gradientLayer.opacity = 0.92
    gradientLayer.cornerCurve = .continuous
    gradientLayer.cornerRadius = surfaceView.layer.cornerRadius
    surfaceView.layer.addSublayer(gradientLayer)

    // SF Symbol on top — white, semibold. Reads cleanly against the
    // saturated gradient.
    symbolImageView.contentMode = .center
    symbolImageView.tintColor = .white
    surfaceView.addSubview(symbolImageView)
    symbolImageView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      symbolImageView.centerXAnchor.constraint(equalTo: surfaceView.centerXAnchor),
      symbolImageView.centerYAnchor.constraint(equalTo: surfaceView.centerYAnchor),
    ])

    applySymbol()
    upgradeToGlassIfAvailable()
    impactFeedback.prepare()
  }

  // MARK: - Layout

  public override func layoutSubviews() {
    super.layoutSubviews()
    surfaceView.frame = bounds
    gradientLayer.frame = surfaceView.bounds
    layer.shadowPath = UIBezierPath(roundedRect: bounds, cornerRadius: surfaceView.layer.cornerRadius).cgPath
  }

  // MARK: - Touch

  public override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    super.touchesBegan(touches, with: event)
    impactFeedback.impactOccurred(intensity: 0.6)
    animateScale(0.94)
  }

  public override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    super.touchesEnded(touches, with: event)
    animateScale(1.0)
    if let t = touches.first, bounds.contains(t.location(in: self)) {
      onPress([:])
    }
  }

  public override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    super.touchesCancelled(touches, with: event)
    animateScale(1.0)
  }

  private func animateScale(_ scale: CGFloat) {
    if #available(iOS 17.0, *) {
      let timing = UISpringTimingParameters(dampingRatio: 0.78, initialVelocity: .zero)
      let animator = UIViewPropertyAnimator(duration: 0.28, timingParameters: timing)
      animator.addAnimations { [weak self] in
        self?.surfaceView.transform = CGAffineTransform(scaleX: scale, y: scale)
      }
      animator.startAnimation()
    } else {
      UIView.animate(withDuration: 0.24, delay: 0, usingSpringWithDamping: 0.78, initialSpringVelocity: 0.6, options: [.allowUserInteraction, .beginFromCurrentState], animations: { [weak self] in
        self?.surfaceView.transform = CGAffineTransform(scaleX: scale, y: scale)
      })
    }
  }

  // MARK: - Public API (set from JS)

  func setSymbolName(_ name: String) {
    self.symbolName = name
    applySymbol()
  }

  func setFocused(_ value: Bool) {
    self.kassaFocused = value
    applySymbol()
    if #available(iOS 17.0, *) {
      let timing = UISpringTimingParameters(dampingRatio: 0.78, initialVelocity: .zero)
      let animator = UIViewPropertyAnimator(duration: 0.32, timingParameters: timing)
      animator.addAnimations { [weak self] in
        let s: CGFloat = value ? 1.04 : 1.0
        self?.transform = CGAffineTransform(scaleX: s, y: s)
      }
      animator.startAnimation()
    }
  }

  // MARK: - Private

  private func applySymbol() {
    if #available(iOS 13.0, *) {
      // Larger symbol, bolder weight — fills the button visually.
      let weight: UIImage.SymbolWeight = kassaFocused ? .bold : .semibold
      let cfg = UIImage.SymbolConfiguration(pointSize: 22, weight: weight, scale: .medium)
      symbolImageView.image = UIImage(systemName: symbolName, withConfiguration: cfg)
    }
  }

  private func upgradeToGlassIfAvailable() {
    if #available(iOS 26.0, *) {
      guard let cls = NSClassFromString("UIGlassEffect") as? NSObject.Type else { return }
      let instance = cls.init()
      if let glass = instance as? UIVisualEffect {
        effectView.effect = glass
      }
    }
  }
}
