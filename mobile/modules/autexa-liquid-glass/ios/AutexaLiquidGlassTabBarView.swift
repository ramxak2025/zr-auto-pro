import ExpoModulesCore
import UIKit

/**
 * AutexaLiquidGlassTabBarView
 * --------------------------------------------------------------------------
 * Premium native iOS tab bar with a Liquid Glass material AND an animated
 * "droplet" highlight that springs between tabs on selection and follows a
 * pan gesture in real time.
 *
 * Architecture:
 *   1. Background — UIVisualEffectView (UIBlurEffect.systemThinMaterial,
 *      auto-upgraded to UIGlassEffect on iOS 26+ via runtime lookup).
 *   2. Top rim — 1px white hairline at the top edge for a glass highlight.
 *   3. Droplet — a UIView with squircle corners (continuous mask)
 *      that sits BEHIND the icons and slides spring-animated between
 *      tab slots. While the user pans inside the bar, the droplet
 *      follows the finger; on release it snaps to the nearest tab and
 *      fires `onPress`.
 *   4. Tab slots — invisible UIView buttons we lay out manually, one per
 *      tab. We don't render the icons natively — JS still draws icons +
 *      labels as RN children on top of this view, addressed via
 *      `insertReactSubview` / standard subview ordering.
 *
 * JS contract:
 *   - prop `tabCount: Int` — how many slots
 *   - prop `activeIndex: Int` — which tab is currently selected
 *   - prop `bottomInset: Double` — safe-area bottom from JS (we read it
 *     so the tab bar lifts above the home indicator)
 *   - event `onTabPress({ index })` — fired when user taps a slot OR
 *     drags the droplet and releases on a slot
 *
 * The native module compiles on every Xcode SDK because the iOS 26
 * UIGlassEffect class is reached via NSClassFromString runtime lookup.
 */
public class AutexaLiquidGlassTabBarView: ExpoView {

  // MARK: - Subviews & layers

  private let effectView: UIVisualEffectView
  private let topRimView: UIView
  private let dropletView: UIView
  private let dropletGradient: CAGradientLayer
  private let panGesture: UIPanGestureRecognizer
  private let tapGesture: UITapGestureRecognizer
  private let selectionFeedback: UISelectionFeedbackGenerator
  private let impactFeedback: UIImpactFeedbackGenerator

  // MARK: - Props from JS

  private var tabCount: Int = 5
  private var activeIndex: Int = 0
  private var bottomInset: CGFloat = 0

  // MARK: - Animation state

  private var isPanning: Bool = false
  private var panStartTabX: CGFloat = 0

  // MARK: - Layout constants

  private let dropletInset: CGFloat = 4   // padding from bar's top/bottom edges
  private let dropletSidePadding: CGFloat = 8 // narrower than slot
  private let dropletCornerRadius: CGFloat = 22

  // The visible bar geometry — bar floats with 14pt horizontal margin and
  // is 58pt tall. JS sets these via the RN style on the wrapper, but we
  // need our own computed slot rects, so we read bounds in layoutSubviews().

  // MARK: - Init

  public required init(appContext: AppContext? = nil) {
    let seed: UIVisualEffect = {
      if #available(iOS 13.0, *) {
        return UIBlurEffect(style: .systemThinMaterial)
      } else {
        return UIBlurEffect(style: .light)
      }
    }()
    self.effectView = UIVisualEffectView(effect: seed)

    self.topRimView = UIView()
    self.topRimView.backgroundColor = UIColor(white: 1.0, alpha: 0.85)
    self.topRimView.isUserInteractionEnabled = false

    self.dropletView = UIView()
    self.dropletView.layer.cornerCurve = .continuous
    self.dropletView.layer.cornerRadius = 18
    self.dropletView.backgroundColor = .clear
    self.dropletView.isUserInteractionEnabled = false
    self.dropletView.layer.shadowColor = UIColor.black.cgColor
    self.dropletView.layer.shadowOpacity = 0.10
    self.dropletView.layer.shadowRadius = 5
    self.dropletView.layer.shadowOffset = CGSize(width: 0, height: 2)
    // Subtle hairline edge — sells the "glass capsule" feel
    self.dropletView.layer.borderWidth = 0.5
    self.dropletView.layer.borderColor = UIColor(white: 1.0, alpha: 0.9).cgColor

    // Three-stop gradient: bright top highlight → mid translucent →
    // slight bottom shadow. Reads as a real glass capsule on every iOS
    // version, regardless of whether UIGlassEffect is available.
    // Colors are set dynamically in updateDropletAppearance() so the
    // capsule adapts correctly between light and dark mode.
    self.dropletGradient = CAGradientLayer()
    self.dropletGradient.colors = [
      UIColor(white: 1.0, alpha: 0.95).cgColor,
      UIColor(white: 1.0, alpha: 0.70).cgColor,
      UIColor(white: 1.0, alpha: 0.85).cgColor,
    ]
    self.dropletGradient.locations = [0.0, 0.55, 1.0]
    self.dropletGradient.startPoint = CGPoint(x: 0.5, y: 0.0)
    self.dropletGradient.endPoint = CGPoint(x: 0.5, y: 1.0)
    self.dropletGradient.cornerCurve = .continuous
    self.dropletGradient.cornerRadius = 18

    self.panGesture = UIPanGestureRecognizer()
    self.tapGesture = UITapGestureRecognizer()
    self.selectionFeedback = UISelectionFeedbackGenerator()
    self.impactFeedback = UIImpactFeedbackGenerator(style: .medium)

    super.init(appContext: appContext)

    backgroundColor = .clear

    // Effect layer fills the bar
    addSubview(effectView)
    effectView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      effectView.topAnchor.constraint(equalTo: topAnchor),
      effectView.bottomAnchor.constraint(equalTo: bottomAnchor),
      effectView.leadingAnchor.constraint(equalTo: leadingAnchor),
      effectView.trailingAnchor.constraint(equalTo: trailingAnchor),
    ])

    // Droplet sits above the effect but below RN children
    addSubview(dropletView)
    dropletView.layer.addSublayer(dropletGradient)

    addSubview(topRimView)
    topRimView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      topRimView.topAnchor.constraint(equalTo: topAnchor),
      topRimView.leadingAnchor.constraint(equalTo: leadingAnchor),
      topRimView.trailingAnchor.constraint(equalTo: trailingAnchor),
      topRimView.heightAnchor.constraint(equalToConstant: 1.0 / UIScreen.main.scale),
    ])

    // Gestures — pan tracks the finger across the bar; tap snaps to nearest slot
    panGesture.addTarget(self, action: #selector(handlePan(_:)))
    panGesture.maximumNumberOfTouches = 1
    addGestureRecognizer(panGesture)

    tapGesture.addTarget(self, action: #selector(handleTap(_:)))
    addGestureRecognizer(tapGesture)

    selectionFeedback.prepare()
    impactFeedback.prepare()

    upgradeToGlassIfAvailable()
    updateDropletAppearance()
  }

  // MARK: - JS-exposed event
  //
  // Expo's `Events("onTabPress")` declaration in the Module file pairs with
  // an `EventDispatcher` property of the SAME name on the view. We just have
  // to declare it here as a stored property — Expo populates it before the
  // view is mounted, and calling it forwards the payload to JS as a
  // synthetic event.  Note: must NOT be `@objc` (EventDispatcher is a Swift
  // generic-style type that doesn't bridge to Objective-C).
  let onTabPress = EventDispatcher()

  fileprivate func emitPress(_ index: Int) {
    onTabPress(["index": index])
  }

  // MARK: - Layout

  public override func layoutSubviews() {
    super.layoutSubviews()
    // Re-layout droplet to current active slot if not panning
    if !isPanning {
      dropletView.frame = dropletFrame(forIndex: activeIndex)
      dropletGradient.frame = dropletView.bounds
    }
    updateDropletAppearance()
  }

  // MARK: - Trait collection (light / dark mode)

  /// Updates the droplet gradient colors and border color to match the
  /// current user interface style. Called from init, layoutSubviews, and
  /// traitCollectionDidChange so the capsule always matches the system theme.
  private func updateDropletAppearance() {
    let isDark = traitCollection.userInterfaceStyle == .dark
    if isDark {
      // Subtle blue-tinted glass capsule — sits naturally on the dark
      // frosted-glass surface without being the jarring white blob.
      dropletGradient.colors = [
        UIColor(red: 0.37, green: 0.55, blue: 0.98, alpha: 0.22).cgColor,
        UIColor(red: 0.25, green: 0.40, blue: 0.90, alpha: 0.12).cgColor,
        UIColor(red: 0.37, green: 0.55, blue: 0.98, alpha: 0.18).cgColor,
      ]
      dropletView.layer.borderColor = UIColor(white: 1.0, alpha: 0.15).cgColor
    } else {
      // Bright white glass capsule — classic light-mode look.
      dropletGradient.colors = [
        UIColor(white: 1.0, alpha: 0.95).cgColor,
        UIColor(white: 1.0, alpha: 0.70).cgColor,
        UIColor(white: 1.0, alpha: 0.85).cgColor,
      ]
      dropletView.layer.borderColor = UIColor(white: 1.0, alpha: 0.9).cgColor
    }
  }

  public override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
      updateDropletAppearance()
    }
  }

  private func dropletFrame(forIndex index: Int) -> CGRect {
    guard tabCount > 0 else { return .zero }
    // Droplet sits inside the icon row only — bottomInset (the home-
    // indicator safe-area) is the bar's lower portion, glass-only.
    let iconAreaH = bounds.height - bottomInset
    let slotW = bounds.width / CGFloat(tabCount)
    let dropletW = slotW - dropletSidePadding * 2
    let dropletH = max(0, iconAreaH - dropletInset * 2)
    let x = CGFloat(index) * slotW + dropletSidePadding
    let y = dropletInset
    return CGRect(x: x, y: y, width: dropletW, height: dropletH)
  }

  // MARK: - Pan gesture — droplet follows finger live (Apple Music feel)
  //
  // Apple Music's bottom controls have a few signature touches when you
  // drag across them:
  //   1. The capsule "presses down" slightly on touch begin (scale 0.96)
  //   2. While dragging fast, it stretches horizontally (>1) and squishes
  //      vertically (<1) — like a real water droplet under acceleration
  //   3. On release it springs back with critical-damping (no overshoot)
  //
  // We model the same behaviour here using direct frame writes during
  // pan (driven by gesture velocity) and a UIView spring on release.

  @objc private func handlePan(_ gr: UIPanGestureRecognizer) {
    let location = gr.location(in: self)
    switch gr.state {
    case .began:
      isPanning = true
      panStartTabX = dropletFrame(forIndex: activeIndex).midX
      // 1. Press-down: subtle scale-down so the user FEELS the touch land.
      UIView.animate(withDuration: 0.16, delay: 0, options: [.curveEaseOut, .allowUserInteraction], animations: { [weak self] in
        guard let self = self else { return }
        self.dropletView.transform = CGAffineTransform(scaleX: 0.96, y: 0.96)
      }, completion: nil)
      selectionFeedback.selectionChanged()

    case .changed:
      // Move droplet so its center tracks the finger; clamp to bar bounds
      let slotW = bounds.width / CGFloat(max(1, tabCount))
      let baseW = slotW - dropletSidePadding * 2
      let iconAreaH = bounds.height - bottomInset
      let baseH = max(0, iconAreaH - dropletInset * 2)

      // Velocity-driven liquid stretch. Wider when moving fast, slightly
      // shorter vertically (water-like deformation). Capped so it never
      // looks cartoony.
      let vx = abs(gr.velocity(in: self).x)
      let stretchX = min(1.22, 1 + vx / 3500)
      let squishY = max(0.88, 1 - vx / 7000)

      let dropletW = baseW * stretchX
      let dropletH = baseH * squishY

      let minX = dropletSidePadding
      let maxX = bounds.width - dropletSidePadding - dropletW
      let proposedX = max(minX, min(maxX, location.x - dropletW / 2))
      let yOffset = (baseH - dropletH) / 2 // keep vertical center fixed

      // Direct frame write — no UIView animation block here (we want
      // strict 1-to-1 finger tracking, no easing lag).
      dropletView.frame = CGRect(
        x: proposedX,
        y: dropletInset + yOffset,
        width: dropletW,
        height: dropletH
      )
      dropletView.transform = .identity
      dropletGradient.frame = dropletView.bounds

      // While dragging, fire a subtle selection haptic each time the
      // droplet's center crosses into a new slot — that "tick…tick"
      // feedback mirrors how Music's volume scrubber feels.
      let centerX = dropletView.frame.midX
      let hovered = max(0, min(tabCount - 1, Int((centerX / slotW).rounded())))
      if hovered != activeIndex {
        selectionFeedback.selectionChanged()
        selectionFeedback.prepare()
        activeIndex = hovered
      }

    case .ended, .cancelled:
      isPanning = false
      // Reset transform from the press-down scale, spring to the slot.
      let slotW = bounds.width / CGFloat(max(1, tabCount))
      let centerX = dropletView.frame.midX
      let nearest = max(0, min(tabCount - 1, Int((centerX / slotW).rounded())))
      activeIndex = nearest
      animateToIndex(nearest)
      impactFeedback.impactOccurred(intensity: 0.55)
      emitPress(nearest)

    default:
      break
    }
  }

  // MARK: - Tap — snap to tapped slot

  @objc private func handleTap(_ gr: UITapGestureRecognizer) {
    let x = gr.location(in: self).x
    let slotW = bounds.width / CGFloat(max(1, tabCount))
    let index = max(0, min(tabCount - 1, Int(x / slotW)))
    if index != activeIndex {
      activeIndex = index
      animateToIndex(index)
      selectionFeedback.selectionChanged()
      emitPress(index)
    }
  }

  // MARK: - Spring animation between tabs
  //
  // We use the modern UIViewPropertyAnimator with a critically-damped
  // spring on iOS 17+ — that gives the same "settle without overshoot"
  // feel Apple uses on the iOS 26 Music control. On older iOS we fall
  // back to the classic UIView.animate spring, which still looks great.

  private func animateToIndex(_ index: Int) {
    let target = dropletFrame(forIndex: index)
    if #available(iOS 17.0, *) {
      let timing = UISpringTimingParameters(dampingRatio: 0.78, initialVelocity: .zero)
      let animator = UIViewPropertyAnimator(duration: 0.45, timingParameters: timing)
      animator.addAnimations { [weak self] in
        guard let self = self else { return }
        self.dropletView.transform = .identity
        self.dropletView.frame = target
        self.dropletGradient.frame = self.dropletView.bounds
      }
      animator.startAnimation()
    } else {
      UIView.animate(
        withDuration: 0.42,
        delay: 0,
        usingSpringWithDamping: 0.78,
        initialSpringVelocity: 0.6,
        options: [.allowUserInteraction, .beginFromCurrentState],
        animations: { [weak self] in
          guard let self = self else { return }
          self.dropletView.transform = .identity
          self.dropletView.frame = target
          self.dropletGradient.frame = self.dropletView.bounds
        },
        completion: nil
      )
    }
  }

  // MARK: - Public API used by the Module file

  func setTabCount(_ count: Int) {
    self.tabCount = max(1, count)
    setNeedsLayout()
  }

  func setActiveIndex(_ index: Int) {
    let clamped = max(0, min(self.tabCount - 1, index))
    if clamped != self.activeIndex {
      self.activeIndex = clamped
      animateToIndex(clamped)
    }
  }

  func setBottomInset(_ inset: CGFloat) {
    self.bottomInset = inset
  }

  // MARK: - iOS 26 UIGlassEffect upgrade

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
