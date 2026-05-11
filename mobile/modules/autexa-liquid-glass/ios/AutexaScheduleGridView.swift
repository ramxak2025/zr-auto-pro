import ExpoModulesCore
import UIKit

/**
 * AutexaScheduleGridView
 * --------------------------------------------------------------------------
 * Premium native iOS schedule grid that REPLACES the previous synchronous-
 * RN-ScrollView implementation. The earlier RN grid stuttered on physical
 * iPhones because two ScrollViews fired onScroll at 120Hz on ProMotion and
 * ping-ponged through the JS bridge to keep their vertical positions in
 * sync. Doing the layout natively with a single UIScrollView eliminates the
 * bridge round-trip entirely — the names column and the cell grid scroll
 * together via standard UIKit content offset, no events, no JS work.
 *
 * Layout (single UIScrollView, contentSize spans the whole grid):
 *
 *   ┌──────────┬─────────────────────── days ──────────────────────────┐
 *   │          │   1    2    3    4   ...                              │  ← top
 *   │ ─────── ─┼──────────────────────────────────────────────────────  │   header
 *   │          │                                                       │
 *   │   Иван  │   ●         ●    ●                                     │   row 1
 *   │   Пётр  │        ●         ●                                     │   row 2
 *   │   ...   │                                                       │
 *   └──────────┴───────────────────────────────────────────────────────┘
 *
 * Sticky behaviour is achieved by transforming the top-left corner, the
 * header row, and the names column on every layoutSubviews call so they
 * follow the scroll offset in their respective axis. This is the same
 * trick UIKit uses internally for compositional layouts with .pinned
 * supplementary items, but written manually so the implementation works
 * on iOS 13+ without compositional layout requirements.
 *
 * Cells:
 *   • day-of-month text in the header row
 *   • status indicator (a coloured pill) per (user × day) intersection
 *   • weekend columns get a subtle red tint
 *   • today column gets a primary tint highlight
 *
 * Status colours mirror the RN legend in ScheduleScreen.tsx:
 *   work       → green
 *   off        → gray
 *   sick       → rose
 *   late_minor → yellow
 *   late_major → orange
 *   absent     → red
 *
 * JS contract:
 *   props:
 *     usersJSON      JSON string [{ id, fullName, initials }]
 *     entriesJSON    JSON string [{ userId, date: 'YYYY-MM-DD', status }]
 *     dateFromISO    'YYYY-MM-DD'
 *     dateToISO      'YYYY-MM-DD'   inclusive
 *     todayISO       'YYYY-MM-DD'
 *     cellWidth      Double, pt
 *     rowHeight      Double, pt
 *     nameColumnWidth Double, pt
 *     headerHeight   Double, pt
 *     reduceMotion   Bool, mirror of UIAccessibility.isReduceMotionEnabled
 *
 *   events:
 *     onCellPress({ userId, dateISO })
 */
public class AutexaScheduleGridView: ExpoView {

  // MARK: - Public events

  let onCellPress = EventDispatcher()

  // MARK: - Sticky containers

  private let scrollView = UIScrollView()
  private let cornerView = UIView()                // top-left, sticky in both axes
  private let headerStrip = UIView()               // top, sticky in Y
  private let namesStrip = UIView()                // left, sticky in X
  private let cellsLayer = UIView()                // free-scrolling cell area

  // MARK: - Data

  private struct UserRow {
    let id: String
    let fullName: String
    let initials: String
  }
  private struct Entry {
    let userId: String
    let date: String   // YYYY-MM-DD
    let status: String
  }
  private var users: [UserRow] = []
  private var entryByKey: [String: String] = [:]   // "userId|date" → status
  private var dateColumns: [String] = []           // YYYY-MM-DD list inclusive
  private var todayISO: String = ""

  // MARK: - Layout knobs

  private var cellWidth: CGFloat = 44
  private var rowHeight: CGFloat = 56
  private var nameColumnWidth: CGFloat = 112
  private var headerHeight: CGFloat = 44

  // Date range is set via two separate props; we cache the partial value
  // here so the second prop arrival can complete the range.
  var cachedDateFrom: String = ""
  var cachedDateTo: String = ""

  // MARK: - Init

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .systemBackground

    scrollView.bounces = true
    scrollView.alwaysBounceVertical = true
    scrollView.alwaysBounceHorizontal = true
    scrollView.showsVerticalScrollIndicator = false
    scrollView.showsHorizontalScrollIndicator = false
    scrollView.delegate = self

    addSubview(scrollView)
    scrollView.addSubview(cellsLayer)
    addSubview(headerStrip)        // siblings of scrollView so they paint above
    addSubview(namesStrip)
    addSubview(cornerView)

    headerStrip.backgroundColor = .systemBackground
    namesStrip.backgroundColor = .systemBackground
    cornerView.backgroundColor = .systemBackground
    headerStrip.layer.shadowColor = UIColor.black.cgColor
    headerStrip.layer.shadowOpacity = 0.05
    headerStrip.layer.shadowRadius = 4
    headerStrip.layer.shadowOffset = CGSize(width: 0, height: 2)
    namesStrip.layer.shadowColor = UIColor.black.cgColor
    namesStrip.layer.shadowOpacity = 0.05
    namesStrip.layer.shadowRadius = 4
    namesStrip.layer.shadowOffset = CGSize(width: 2, height: 0)
  }

  // MARK: - Layout

  public override func layoutSubviews() {
    super.layoutSubviews()
    scrollView.frame = bounds
    let totalContentW = nameColumnWidth + cellWidth * CGFloat(dateColumns.count)
    let totalContentH = headerHeight + rowHeight * CGFloat(users.count)
    scrollView.contentSize = CGSize(width: totalContentW, height: totalContentH)

    cellsLayer.frame = CGRect(x: 0, y: 0, width: totalContentW, height: totalContentH)

    // Sticky strip frames — sized to bar dimensions, positioned via
    // contentOffset transform on every scroll.
    let stickyW = bounds.width
    let stickyH = bounds.height
    headerStrip.frame = CGRect(x: 0, y: 0, width: stickyW, height: headerHeight)
    namesStrip.frame = CGRect(x: 0, y: 0, width: nameColumnWidth, height: stickyH)
    cornerView.frame = CGRect(x: 0, y: 0, width: nameColumnWidth, height: headerHeight)

    rebuildSubviewsIfNeeded()
    syncStickyTransforms()
  }

  // MARK: - Subview build

  private var hasBuilt = false

  private func rebuildSubviewsIfNeeded() {
    // Only rebuild when bounds is non-zero AND we have data. Multiple
    // calls reuse existing subviews; we wipe + rebuild on data change.
    if !hasBuilt && !dateColumns.isEmpty && !users.isEmpty {
      buildAll()
      hasBuilt = true
    }
  }

  private func buildAll() {
    cellsLayer.subviews.forEach { $0.removeFromSuperview() }
    headerStrip.subviews.forEach { $0.removeFromSuperview() }
    namesStrip.subviews.forEach { $0.removeFromSuperview() }
    cornerView.subviews.forEach { $0.removeFromSuperview() }

    // Header — day numbers
    for (i, dateISO) in dateColumns.enumerated() {
      let header = UILabel(frame: CGRect(
        x: nameColumnWidth + CGFloat(i) * cellWidth,
        y: 0,
        width: cellWidth,
        height: headerHeight
      ))
      header.textAlignment = .center
      header.font = .systemFont(ofSize: 13, weight: .semibold)
      header.text = String(dayOfMonth(dateISO))
      header.textColor = (dateISO == todayISO) ? UIColor.systemBlue : UIColor.label
      if isWeekend(dateISO) {
        header.textColor = UIColor.systemRed.withAlphaComponent(0.7)
      }
      headerStrip.addSubview(header)
    }

    // Names — left column
    for (rowIdx, user) in users.enumerated() {
      let row = UIView(frame: CGRect(x: 0, y: headerHeight + CGFloat(rowIdx) * rowHeight, width: nameColumnWidth, height: rowHeight))

      let initialsCircle = UIView(frame: CGRect(x: 8, y: (rowHeight - 32) / 2, width: 32, height: 32))
      initialsCircle.layer.cornerRadius = 16
      initialsCircle.layer.cornerCurve = .continuous
      initialsCircle.backgroundColor = avatarBg(user.initials)
      let initialsLabel = UILabel(frame: initialsCircle.bounds)
      initialsLabel.text = user.initials
      initialsLabel.textAlignment = .center
      initialsLabel.font = .systemFont(ofSize: 13, weight: .semibold)
      initialsLabel.textColor = .white
      initialsCircle.addSubview(initialsLabel)
      row.addSubview(initialsCircle)

      let nameLabel = UILabel(frame: CGRect(x: 48, y: 0, width: nameColumnWidth - 56, height: rowHeight))
      nameLabel.text = user.fullName
      nameLabel.font = .systemFont(ofSize: 14, weight: .medium)
      nameLabel.textColor = .label
      nameLabel.numberOfLines = 2
      row.addSubview(nameLabel)

      let separator = UIView(frame: CGRect(x: 0, y: rowHeight - 0.5, width: nameColumnWidth, height: 0.5))
      separator.backgroundColor = UIColor.separator
      row.addSubview(separator)

      namesStrip.addSubview(row)
    }

    // Cells
    for (rowIdx, user) in users.enumerated() {
      for (colIdx, dateISO) in dateColumns.enumerated() {
        let frame = CGRect(
          x: nameColumnWidth + CGFloat(colIdx) * cellWidth,
          y: headerHeight + CGFloat(rowIdx) * rowHeight,
          width: cellWidth,
          height: rowHeight
        )
        let cell = UIControl(frame: frame)
        cell.tag = rowIdx * 10000 + colIdx
        cell.addTarget(self, action: #selector(handleCellTap(_:)), for: .touchUpInside)

        // Cell background tints
        if dateISO == todayISO {
          cell.backgroundColor = UIColor.systemBlue.withAlphaComponent(0.04)
        } else if isWeekend(dateISO) {
          cell.backgroundColor = UIColor.systemRed.withAlphaComponent(0.03)
        } else if rowIdx % 2 == 1 {
          cell.backgroundColor = UIColor.tertiarySystemFill.withAlphaComponent(0.4)
        } else {
          cell.backgroundColor = .clear
        }

        // Status indicator — small pill or dot
        let key = "\(user.id)|\(dateISO)"
        if let status = entryByKey[key] {
          let pill = UIView(frame: CGRect(
            x: (cellWidth - 14) / 2,
            y: (rowHeight - 14) / 2,
            width: 14,
            height: 14
          ))
          pill.layer.cornerRadius = 7
          pill.backgroundColor = colorForStatus(status)
          cell.addSubview(pill)
        }

        // Hairline grid line — right edge of cell
        let vSep = UIView(frame: CGRect(x: cellWidth - 0.5, y: 0, width: 0.5, height: rowHeight))
        vSep.backgroundColor = UIColor.separator.withAlphaComponent(0.5)
        cell.addSubview(vSep)
        let hSep = UIView(frame: CGRect(x: 0, y: rowHeight - 0.5, width: cellWidth, height: 0.5))
        hSep.backgroundColor = UIColor.separator.withAlphaComponent(0.5)
        cell.addSubview(hSep)

        cellsLayer.addSubview(cell)
      }
    }

    // Corner — minimal, just block the cells under it
    cornerView.layer.borderWidth = 0
    cornerView.backgroundColor = .systemBackground
  }

  // MARK: - Sticky transforms

  private func syncStickyTransforms() {
    let offset = scrollView.contentOffset
    headerStrip.transform = CGAffineTransform(translationX: -offset.x, y: 0)
    namesStrip.transform = CGAffineTransform(translationX: 0, y: -offset.y)
    cornerView.transform = .identity   // pinned at (0,0) above both strips
  }

  // MARK: - Cell tap

  @objc private func handleCellTap(_ sender: UIControl) {
    let rowIdx = sender.tag / 10000
    let colIdx = sender.tag % 10000
    guard rowIdx < users.count, colIdx < dateColumns.count else { return }
    let userId = users[rowIdx].id
    let dateISO = dateColumns[colIdx]
    onCellPress(["userId": userId, "dateISO": dateISO])
  }

  // MARK: - Setters from JS

  func setUsersJSON(_ json: String) {
    guard let data = json.data(using: .utf8),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
    self.users = arr.compactMap { d in
      guard let id = d["id"] as? String, let fullName = d["fullName"] as? String else { return nil }
      let initials = (d["initials"] as? String) ?? String(fullName.prefix(2)).uppercased()
      return UserRow(id: id, fullName: fullName, initials: initials)
    }
    hasBuilt = false
    setNeedsLayout()
  }

  func setEntriesJSON(_ json: String) {
    guard let data = json.data(using: .utf8),
          let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
    var map: [String: String] = [:]
    for d in arr {
      if let userId = d["userId"] as? String,
         let date = d["date"] as? String,
         let status = d["status"] as? String {
        map["\(userId)|\(date)"] = status
      }
    }
    self.entryByKey = map
    hasBuilt = false
    setNeedsLayout()
  }

  func setDateRange(from: String, to: String) {
    self.dateColumns = enumerateDates(from: from, to: to)
    hasBuilt = false
    setNeedsLayout()
  }

  func setToday(_ iso: String) { self.todayISO = iso }
  func setCellWidth(_ w: CGFloat) { self.cellWidth = max(20, w); setNeedsLayout() }
  func setRowHeight(_ h: CGFloat) { self.rowHeight = max(28, h); setNeedsLayout() }
  func setNameColumnWidth(_ w: CGFloat) { self.nameColumnWidth = max(60, w); setNeedsLayout() }
  func setHeaderHeight(_ h: CGFloat) { self.headerHeight = max(20, h); setNeedsLayout() }

  // MARK: - Helpers

  private func dayOfMonth(_ iso: String) -> Int {
    // ISO format YYYY-MM-DD — slice the day directly without DateFormatter
    let parts = iso.split(separator: "-")
    if parts.count >= 3, let day = Int(parts[2]) { return day }
    return 0
  }

  private func isWeekend(_ iso: String) -> Bool {
    var calendar = Calendar(identifier: .gregorian)
    calendar.firstWeekday = 2 // Mon
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    guard let d = formatter.date(from: iso) else { return false }
    let weekday = calendar.component(.weekday, from: d)
    return weekday == 1 || weekday == 7
  }

  private func enumerateDates(from: String, to: String) -> [String] {
    let formatter = DateFormatter()
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    guard var cursor = formatter.date(from: from), let end = formatter.date(from: to) else { return [] }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
    var result: [String] = []
    while cursor <= end {
      result.append(formatter.string(from: cursor))
      guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
      cursor = next
    }
    return result
  }

  private func colorForStatus(_ status: String) -> UIColor {
    switch status {
    case "work":       return UIColor.systemGreen
    case "off":        return UIColor.systemGray
    case "sick":       return UIColor(red: 0.96, green: 0.34, blue: 0.45, alpha: 1.0)
    case "late_minor": return UIColor.systemYellow
    case "late_major": return UIColor.systemOrange
    case "absent":     return UIColor.systemRed
    default:           return UIColor.systemGray3
    }
  }

  private func avatarBg(_ initials: String) -> UIColor {
    // Stable hue from initials hash → bg colour. Same idea as the RN
    // version's getAvatarColors, simplified.
    var hash = 0
    for ch in initials.unicodeScalars { hash = (hash &* 31) &+ Int(ch.value) }
    let hue = CGFloat((hash & 0xFF)) / 255.0
    return UIColor(hue: hue, saturation: 0.55, brightness: 0.65, alpha: 1.0)
  }
}

// MARK: - UIScrollViewDelegate

extension AutexaScheduleGridView: UIScrollViewDelegate {
  public func scrollViewDidScroll(_ scrollView: UIScrollView) {
    syncStickyTransforms()
  }
}
