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
    self.dropletView.layer.cornerRadius = 22
    self.dropletView.backgroundColor = .clear
    self.dropletView.isUserInteractionEnabled = false
    self.dropletView.layer.shadowColor = UIColor.systemBlue.cgColor
    self.dropletView.layer.shadowOpacity = 0.18
    self.dropletView.layer.shadowRadius = 6
    self.dropletView.layer.shadowOffset = CGSize(width: 0, height: 2)

    self.dropletGradient = CAGradientLayer()
    self.dropletGradient.colors = [
      UIColor(white: 1.0, alpha: 0.95).cgColor,
      UIColor(white: 1.0, alpha: 0.55).cgColor,
    ]
    self.dropletGradient.startPoint = CGPoint(x: 0.5, y: 0.0)
    self.dropletGradient.endPoint = CGPoint(x: 0.5, y: 1.0)
    self.dropletGradient.cornerCurve = .continuous

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
  }

  // MARK: - JS-exposed event

  @objc public var onTabPress: EventDispatcher? = nil
  // ExpoModulesCore wires this up via the View() definition in the Module file.

  // Helper used by setActiveIndex / gesture handlers — declared as a closure
  // so the Module file can override it after instantiation.
  fileprivate func emitPress(_ index: Int) {
    guard let dispatch = onTabPress else { return }
    dispatch(["index": index])
  }

  // MARK: - Layout

  public override func layoutSubviews() {
    super.layoutSubviews()
    // Re-layout droplet to current active slot if not panning
    if !isPanning {
      dropletView.frame = dropletFrame(forIndex: activeIndex)
      dropletGradient.frame = dropletView.bounds
    }
  }

  private func dropletFrame(forIndex index: Int) -> CGRect {
    guard tabCount > 0 else { return .zero }
    let slotW = bounds.width / CGFloat(tabCount)
    let dropletW = slotW - dropletSidePadding * 2
    let dropletH = bounds.height - dropletInset * 2
    let x = CGFloat(index) * slotW + dropletSidePadding
    let y = dropletInset
    return CGRect(x: x, y: y, width: dropletW, height: dropletH)
  }

  // MARK: - Pan gesture — droplet follows finger live

  @objc private func handlePan(_ gr: UIPanGestureRecognizer) {
    let location = gr.location(in: self)
    switch gr.state {
    case .began:
      isPanning = true
      panStartTabX = dropletFrame(forIndex: activeIndex).midX
    case .changed:
      // Move droplet so its center tracks the finger; clamp to bar bounds
      let slotW = bounds.width / CGFloat(max(1, tabCount))
      let dropletW = slotW - dropletSidePadding * 2
      let minX = dropletSidePadding
      let maxX = bounds.width - dropletSidePadding - dropletW
      let proposedX = max(minX, min(maxX, location.x - dropletW / 2))
      var f = dropletView.frame
      f.origin.x = proposedX
      // Slight horizontal stretch when moving fast — capture the velocity
      let vx = abs(gr.velocity(in: self).x)
      let stretch = min(1.18, 1 + vx / 4000)
      f.size.width = (slotW - dropletSidePadding * 2) * stretch
      dropletView.frame = f
      dropletGradient.frame = dropletView.bounds
    case .ended, .cancelled:
      isPanning = false
      // Snap to nearest tab
      let slotW = bounds.width / CGFloat(max(1, tabCount))
      let centerX = dropletView.frame.midX
      let nearest = max(0, min(tabCount - 1, Int((centerX / slotW).rounded())))
      animateToIndex(nearest)
      if nearest != activeIndex {
        activeIndex = nearest
        impactFeedback.impactOccurred(intensity: 0.7)
        emitPress(nearest)
      } else {
        // tiny haptic to confirm snap
        selectionFeedback.selectionChanged()
      }
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

  private func animateToIndex(_ index: Int) {
    let target = dropletFrame(forIndex: index)
    UIView.animate(
      withDuration: 0.42,
      delay: 0,
      usingSpringWithDamping: 0.72,
      initialSpringVelocity: 0.6,
      options: [.allowUserInteraction, .beginFromCurrentState],
      animations: { [weak self] in
        guard let self = self else { return }
        self.dropletView.frame = target
        self.dropletGradient.frame = self.dropletView.bounds
      },
      completion: nil
    )
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
