/**
 * Ionicons-name → Lucide component name + fill hint.
 *
 * Why this shim exists:
 *   `@expo/vector-icons` renders icons as font glyphs (Text with a custom
 *   fontFamily). On Android we had repeated, hard-to-debug cases where the
 *   font wasn't resolving — empty boxes everywhere on the user's device,
 *   despite ReactFontManager.addCustomFont being registered.
 *
 *   Switching to Lucide (which renders react-native-svg paths) removes
 *   that whole class of bugs: there is no native font registration step,
 *   the SVG path is rendered directly via react-native-svg primitives
 *   that already work in this project (charts, plate badge, ...).
 *
 *   Behaviour: each Ionicons name maps to a Lucide icon component. The
 *   `solid` hint controls strokeWidth so the *-outline variant stays
 *   thin and the non-outline variant reads bolder, matching the visual
 *   weight of the original Ionicons set.
 */
export interface IconMapEntry {
  /** Component name in `lucide-react-native` (key on the namespace import). */
  lucide: string;
  /** true → bolder stroke (matches Ionicons' filled style). */
  solid?: boolean;
  /** true → render with fill (instead of just stroke). For pill/badge icons. */
  fill?: boolean;
}

export const IONICON_TO_LUCIDE: Record<string, IconMapEntry> = {
  // ── add / remove ──────────────────────────────────────────────────────
  add: { lucide: 'Plus', solid: true },
  'add-circle': { lucide: 'PlusCircle', solid: true },
  'add-circle-outline': { lucide: 'PlusCircle' },
  remove: { lucide: 'Minus', solid: true },
  'remove-outline': { lucide: 'Minus' },

  // ── filters / misc (were falling back to a meaningless Circle) ─────────
  apps: { lucide: 'LayoutGrid', solid: true },
  'apps-outline': { lucide: 'LayoutGrid' },
  sparkles: { lucide: 'Sparkles', solid: true },
  'sparkles-outline': { lucide: 'Sparkles' },
  ellipse: { lucide: 'Circle', fill: true },
  'ellipse-outline': { lucide: 'Circle' },
  pricetag: { lucide: 'Tag', solid: true },
  'help-circle': { lucide: 'HelpCircle', solid: true },
  bulb: { lucide: 'Lightbulb', solid: true },
  'bulb-outline': { lucide: 'Lightbulb' },
  archive: { lucide: 'Archive', solid: true },
  'archive-outline': { lucide: 'Archive' },
  heart: { lucide: 'Heart', solid: true, fill: true },
  'heart-outline': { lucide: 'Heart' },
  medal: { lucide: 'Medal', solid: true },
  'medal-outline': { lucide: 'Medal' },

  // ── arrows ────────────────────────────────────────────────────────────
  'arrow-back': { lucide: 'ArrowLeft', solid: true },
  'arrow-forward': { lucide: 'ArrowRight', solid: true },
  'arrow-up': { lucide: 'ArrowUp', solid: true },
  'arrow-up-outline': { lucide: 'ArrowUp' },
  'arrow-down': { lucide: 'ArrowDown', solid: true },
  'arrow-down-outline': { lucide: 'ArrowDown' },
  'arrow-up-circle': { lucide: 'ArrowUpCircle', solid: true },
  'arrow-undo': { lucide: 'Undo2', solid: true },
  'arrow-undo-outline': { lucide: 'Undo2' },
  'swap-horizontal': { lucide: 'ArrowLeftRight', solid: true },
  'swap-horizontal-outline': { lucide: 'ArrowLeftRight' },

  // ── chevrons ──────────────────────────────────────────────────────────
  'chevron-back': { lucide: 'ChevronLeft', solid: true },
  'chevron-forward': { lucide: 'ChevronRight', solid: true },
  'chevron-up': { lucide: 'ChevronUp', solid: true },
  'chevron-down': { lucide: 'ChevronDown', solid: true },
  'play-back': { lucide: 'SkipBack', solid: true, fill: true },
  'play-forward': { lucide: 'SkipForward', solid: true, fill: true },

  // ── close / check ─────────────────────────────────────────────────────
  close: { lucide: 'X', solid: true },
  'close-circle': { lucide: 'XCircle', solid: true, fill: true },
  'close-circle-outline': { lucide: 'XCircle' },
  checkmark: { lucide: 'Check', solid: true },
  'checkmark-circle': { lucide: 'CheckCircle', solid: true, fill: true },
  'checkmark-circle-outline': { lucide: 'CheckCircle' },

  // ── people / accounts ─────────────────────────────────────────────────
  person: { lucide: 'User', solid: true, fill: true },
  'person-outline': { lucide: 'User' },
  'person-circle': { lucide: 'CircleUserRound', solid: true, fill: true },
  'person-circle-outline': { lucide: 'CircleUserRound' },
  people: { lucide: 'Users', solid: true, fill: true },
  'people-outline': { lucide: 'Users' },
  'people-circle': { lucide: 'UsersRound', solid: true, fill: true },
  'people-circle-outline': { lucide: 'UsersRound' },

  // ── communication ─────────────────────────────────────────────────────
  'call-outline': { lucide: 'Phone' },
  'chatbubble-outline': { lucide: 'MessageSquare' },
  'chatbubble-ellipses': { lucide: 'MessageCircle', solid: true, fill: true },
  'chatbubble-ellipses-outline': { lucide: 'MessageCircle' },
  'chatbubbles-outline': { lucide: 'MessagesSquare' },
  'paper-plane-outline': { lucide: 'Send' },
  send: { lucide: 'Send', solid: true, fill: true },
  'logo-whatsapp': { lucide: 'MessageCircle' },

  // ── commerce / money ──────────────────────────────────────────────────
  'card-outline': { lucide: 'CreditCard' },
  'cart-outline': { lucide: 'ShoppingCart' },
  'cash-outline': { lucide: 'Banknote' },
  'wallet-outline': { lucide: 'Wallet' },
  'pricetag-outline': { lucide: 'Tag' },
  'pricetags-outline': { lucide: 'Tags' },
  'gift-outline': { lucide: 'Gift' },
  'receipt-outline': { lucide: 'Receipt' },
  receipt: { lucide: 'Receipt', solid: true, fill: true },
  'storefront-outline': { lucide: 'Store' },

  // ── productivity / docs ───────────────────────────────────────────────
  'clipboard-outline': { lucide: 'Clipboard' },
  'document-text-outline': { lucide: 'FileText' },
  'folder-open-outline': { lucide: 'FolderOpen' },
  folder: { lucide: 'Folder', solid: true, fill: true },
  'layers-outline': { lucide: 'Layers' },
  'create-outline': { lucide: 'Pencil' },
  pencil: { lucide: 'Pencil', solid: true },
  'pencil-outline': { lucide: 'Pencil' },
  'cut-outline': { lucide: 'Scissors' },
  'trash-outline': { lucide: 'Trash2' },
  'trash-bin-outline': { lucide: 'Trash2' },
  trash: { lucide: 'Trash2', solid: true },

  // ── vehicles / locations ──────────────────────────────────────────────
  'car-outline': { lucide: 'Car' },
  'car-sport-outline': { lucide: 'Car' },
  'car-sport': { lucide: 'Car', solid: true, fill: true },
  'bus-outline': { lucide: 'Bus' },
  'home-outline': { lucide: 'Home' },
  'business-outline': { lucide: 'Building2' },
  business: { lucide: 'Building2', solid: true, fill: true },

  // ── work / tools ──────────────────────────────────────────────────────
  'build-outline': { lucide: 'Wrench' },
  build: { lucide: 'Wrench', solid: true },
  'construct-outline': { lucide: 'Wrench' },
  'cube-outline': { lucide: 'Box' },
  cube: { lucide: 'Box', solid: true, fill: true },
  'camera-outline': { lucide: 'Camera' },
  camera: { lucide: 'Camera', solid: true, fill: true },

  // ── status / charts ───────────────────────────────────────────────────
  'analytics-outline': { lucide: 'BarChart3' },
  'stats-chart': { lucide: 'BarChart3', solid: true },
  'bar-chart': { lucide: 'BarChart3', solid: true },
  'bar-chart-outline': { lucide: 'BarChart3' },
  'pie-chart-outline': { lucide: 'PieChart' },
  'pie-chart': { lucide: 'PieChart', solid: true, fill: true },
  speedometer: { lucide: 'Gauge', solid: true },
  'speedometer-outline': { lucide: 'Gauge' },
  'trending-up': { lucide: 'TrendingUp', solid: true },
  'trending-up-outline': { lucide: 'TrendingUp' },
  'trending-down-outline': { lucide: 'TrendingDown' },
  trophy: { lucide: 'Trophy', solid: true, fill: true },
  'trophy-outline': { lucide: 'Trophy' },
  star: { lucide: 'Star', solid: true, fill: true },

  // ── ui / time / system ────────────────────────────────────────────────
  'calendar-outline': { lucide: 'Calendar' },
  'today-outline': { lucide: 'CalendarCheck' },
  'time-outline': { lucide: 'Clock' },
  'hourglass-outline': { lucide: 'Hourglass' },
  'globe-outline': { lucide: 'Globe' },
  'moon-outline': { lucide: 'Moon' },
  'flash-outline': { lucide: 'Zap' },
  'cloud-offline-outline': { lucide: 'CloudOff' },
  'expand-outline': { lucide: 'Maximize2' },
  search: { lucide: 'Search', solid: true },
  'search-outline': { lucide: 'Search' },
  'alert-circle': { lucide: 'AlertCircle', solid: true, fill: true },
  'information-circle-outline': { lucide: 'Info' },
  warning: { lucide: 'AlertTriangle', solid: true, fill: true },
  'warning-outline': { lucide: 'AlertTriangle' },
  'lock-closed': { lucide: 'Lock', solid: true, fill: true },
  'enter-outline': { lucide: 'LogIn' },
  'exit-outline': { lucide: 'LogOut' },
  'log-out-outline': { lucide: 'LogOut' },

  // ── additional commonly-used (fallbacks for any *-outline naming) ─────
  'shield-outline': { lucide: 'Shield' },
  'shield-checkmark-outline': { lucide: 'ShieldCheck' },
  'mail-outline': { lucide: 'Mail' },
  'settings-outline': { lucide: 'Settings' },
  'megaphone-outline': { lucide: 'Megaphone' },
  'options-outline': { lucide: 'SlidersHorizontal' },
  eye: { lucide: 'Eye', solid: true },
  'eye-outline': { lucide: 'Eye' },
  'eye-off': { lucide: 'EyeOff', solid: true },
  'eye-off-outline': { lucide: 'EyeOff' },
  'refresh-outline': { lucide: 'RefreshCw' },
  'ellipsis-horizontal': { lucide: 'MoreHorizontal', solid: true },
  'ellipsis-vertical': { lucide: 'MoreVertical', solid: true },

  // ── extra coverage (icons referenced as dynamic strings elsewhere) ─────
  alarm: { lucide: 'AlarmClock', solid: true },
  'alarm-outline': { lucide: 'AlarmClock' },
  'alert-circle-outline': { lucide: 'AlertCircle' },
  calendar: { lucide: 'Calendar', solid: true },
  'chatbox-outline': { lucide: 'MessageSquare' },
  'grid-outline': { lucide: 'LayoutGrid' },
  grid: { lucide: 'LayoutGrid', solid: true, fill: true },
  'help-circle-outline': { lucide: 'HelpCircle' },
  home: { lucide: 'Home', solid: true, fill: true },
  journal: { lucide: 'BookOpen', solid: true },
  'link-outline': { lucide: 'Link' },
  'location-outline': { lucide: 'MapPin' },
  'map-outline': { lucide: 'Map' },
  medkit: { lucide: 'BriefcaseMedical', solid: true, fill: true },
  'medkit-outline': { lucide: 'BriefcaseMedical' },
  menu: { lucide: 'Menu', solid: true },
  moon: { lucide: 'Moon', solid: true, fill: true },
  sun: { lucide: 'Sun', solid: true, fill: true },
  'navigate-outline': { lucide: 'Navigation' },
  'send-outline': { lucide: 'Send' },
  'stats-chart-outline': { lucide: 'BarChart3' },
  warehouse: { lucide: 'Warehouse' },

  // ── owner-reported gaps (icons that previously fell back to Circle) ────
  // Schedule tabs: filled / active glyphs paired with their outline variants.
  today: { lucide: 'CalendarCheck', solid: true, fill: false },
  settings: { lucide: 'Settings', solid: true },
  // CheckCreateScreen "Отложить чек": checkbox toggle + submit pause icon.
  checkbox: { lucide: 'SquareCheck', solid: true },
  'checkbox-outline': { lucide: 'Square' },
  'square-outline': { lucide: 'Square' },
  square: { lucide: 'Square', solid: true },
  'pause-circle': { lucide: 'Pause', solid: true, fill: true },
  'pause-circle-outline': { lucide: 'Pause' },
  // ChecksScreen filter button (funnel) + sync (reload).
  funnel: { lucide: 'Funnel', solid: true, fill: true },
  'funnel-outline': { lucide: 'Funnel' },
  // Verified-status / trust glyphs (e.g. user list, supplier card).
  'shield-checkmark': { lucide: 'ShieldCheck', solid: true, fill: true },
  // Sync / pull-to-refresh affordances rendered as text icons in some lists.
  sync: { lucide: 'RotateCw', solid: true },
  'sync-outline': { lucide: 'RotateCw' },

  // ── final dark-theme audit pass (2026-05) ─────────────────────────────
  // Icons referenced in screens but previously falling back to Circle.
  // Barcode / catalog / equipment scanning.
  'barcode-outline': { lucide: 'Barcode' },
  barcode: { lucide: 'Barcode', solid: true },
  // Bookmark / favorite.
  'bookmark-outline': { lucide: 'Bookmark' },
  bookmark: { lucide: 'Bookmark', solid: true, fill: true },
  // Upload / download / cloud sync affordances.
  'cloud-upload-outline': { lucide: 'UploadCloud' },
  'cloud-upload': { lucide: 'UploadCloud', solid: true },
  'download-outline': { lucide: 'Download' },
  download: { lucide: 'Download', solid: true },
  'cloud-download-outline': { lucide: 'DownloadCloud' },
  // Copy / clipboard duplicate.
  'copy-outline': { lucide: 'Copy' },
  copy: { lucide: 'Copy', solid: true },
  // Fire / hot indicators (popular check, hot prospect).
  flame: { lucide: 'Flame', solid: true, fill: true },
  'flame-outline': { lucide: 'Flame' },
  // Hammer — used in equipment / service controls.
  hammer: { lucide: 'Hammer', solid: true },
  'hammer-outline': { lucide: 'Hammer' },
  // Multi-image picker.
  'images-outline': { lucide: 'Images' },
  images: { lucide: 'Images', solid: true, fill: true },
  // Repeat / loop (recurring expenses, subscriptions).
  'repeat-outline': { lucide: 'Repeat' },
  repeat: { lucide: 'Repeat', solid: true },
  // Share / system share-sheet trigger.
  'share-outline': { lucide: 'Share' },
  share: { lucide: 'Share', solid: true },
  'share-social': { lucide: 'Share2', solid: true },
  'share-social-outline': { lucide: 'Share2' },
  // Star outline variant.
  'star-outline': { lucide: 'Star' },
  // Notifications bell.
  'notifications-outline': { lucide: 'Bell' },
  notifications: { lucide: 'Bell', solid: true, fill: true },
  // Return / back affordance (CheckDetail return-to-supplier).
  'return-down-back-outline': { lucide: 'CornerDownLeft' },
  'return-down-back': { lucide: 'CornerDownLeft', solid: true },
  // Generic plus aliases.
  'add-outline': { lucide: 'Plus' },
  'remove-circle': { lucide: 'MinusCircle', solid: true },
  'remove-circle-outline': { lucide: 'MinusCircle' },
  // Play / pause.
  play: { lucide: 'Play', solid: true, fill: true },
  'play-outline': { lucide: 'Play' },
  pause: { lucide: 'Pause', solid: true, fill: true },
  'pause-outline': { lucide: 'Pause' },
  // Refresh.
  refresh: { lucide: 'RefreshCw', solid: true },
  // Mail.
  mail: { lucide: 'Mail', solid: true, fill: true },
  // Location.
  location: { lucide: 'MapPin', solid: true, fill: true },
  // Time.
  time: { lucide: 'Clock', solid: true },
  // Briefcase / work.
  briefcase: { lucide: 'Briefcase', solid: true, fill: true },
  'briefcase-outline': { lucide: 'Briefcase' },
  // Wallet / card filled.
  wallet: { lucide: 'Wallet', solid: true, fill: true },
  card: { lucide: 'CreditCard', solid: true, fill: true },
  // Link / hyperlink.
  link: { lucide: 'Link', solid: true },
  // Lock outline.
  'lock-closed-outline': { lucide: 'Lock' },
  // Cog alias for settings.
  cog: { lucide: 'Settings', solid: true },
  'cog-outline': { lucide: 'Settings' },
  // Receipt outline filled.
  'storefront': { lucide: 'Store', solid: true, fill: true },
  // EquipmentScreen "Форма" section.
  'shirt-outline': { lucide: 'Shirt' },
  shirt: { lucide: 'Shirt', solid: true, fill: true },
  // Play-circle variants (used in admin Activate buttons).
  'play-circle': { lucide: 'PlayCircle', solid: true, fill: true },
  'play-circle-outline': { lucide: 'PlayCircle' },
  // Construct (alias of construct-outline).
  construct: { lucide: 'Wrench', solid: true },
  // Document/text variants for sheets.
  document: { lucide: 'FileText', solid: true, fill: true },
  'document-outline': { lucide: 'FileText' },

  // ── Reports / Salary / Schedule cosmetic-bug audit (2026-05) ───────────
  // Trends → pair the outline variant already present with a solid
  // glyph (used in the Reports HERO when net profit is negative).
  'trending-down': { lucide: 'TrendingDown', solid: true },
  // Picture/image variants — Reports has an "Картинка" export tile that
  // previously fell back to Circle.
  'image-outline': { lucide: 'Image' },
  image: { lucide: 'Image', solid: true, fill: true },
  // Pulse — used in Reports AI-insights for "revenue up but profit
  // lagging" insight; we previously rendered Circle for it.
  'pulse-outline': { lucide: 'Activity' },
  pulse: { lucide: 'Activity', solid: true },
  // Ribbon — Salary screen "Премии за месяц" section + "Добавить премию"
  // CTA + premium row icon. Was rendering as a Circle blob.
  ribbon: { lucide: 'Ribbon', solid: true, fill: true },
  'ribbon-outline': { lucide: 'Ribbon' },
  // Wallet filled — Salary screen "Выдать зарплату" CTA. Outline already
  // present, this is the solid variant matching the gradient pill.
  // The owner explicitly asked for a CLEAN stroke version for the give-
  // salary button, so we keep it non-filled and reuse `wallet-outline`
  // weight instead. The filled wallet stays available for places that
  // really need the heavy glyph.
  // Flash (filled) — Salary screen "Аванс" pill on a coloured gradient.
  flash: { lucide: 'Zap', solid: true, fill: true },
  // Save (outline) — Schedule settings tab Сохранить button. The
  // previously-rendered Circle blob was the reason owner saw "save shows
  // a circle".
  'save-outline': { lucide: 'Save' },
  save: { lucide: 'Save', solid: true },
  // Arrow-up-circle — kept as outline-only since we use it as a "send up
  // / pay out" affordance in Salary. Filled version handled separately.
  'arrow-up-circle-outline': { lucide: 'ArrowUpCircle' },

  // ── Marketing / Mailings / Integrations audit (2026-05) ───────────────
  // Active variants of tabs that previously fell back to Circle when the
  // screen stripped the `-outline` suffix at runtime. `pie-chart-outline`
  // is intentionally not redeclared here — it's already mapped earlier.
  chatbubbles: { lucide: 'MessagesSquare', solid: true, fill: true },
  chatbox: { lucide: 'MessageSquare', solid: true, fill: true },
  // Active variants of the Mailings tab segmented control + the manual
  // review-request CTA inside MarketingScreen.
  'paper-plane': { lucide: 'Send', solid: true, fill: true },
  // MoreScreen "Интеграции" menu entry — owner reported a circle. The
  // SF-Symbols-equivalent is "puzzlepiece.extension".
  'extension-puzzle-outline': { lucide: 'Puzzle' },
  'extension-puzzle': { lucide: 'Puzzle', solid: true, fill: true },
  // IntegrationsScreen — "Мегафон ВАТС" card icon owner reported missing.
  'cellular-outline': { lucide: 'Signal' },
  cellular: { lucide: 'Signal', solid: true },
  // IntegrationsScreen — modal "Журнал событий" header icon was a circle.
  'terminal-outline': { lucide: 'Terminal' },
  terminal: { lucide: 'Terminal', solid: true },
  // Logo-google — Lucide has no brand mark; render as a globe so the
  // status card still has a visible affordance.
  'logo-google': { lucide: 'Globe', solid: true, fill: false },
};
