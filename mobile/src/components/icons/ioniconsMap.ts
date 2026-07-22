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
  /**
   * true → also fill the SVG paths with `color` (not just stroke them).
   *
   * ВАЖНО (правило fill-аудита 2026-06): the shim passes `fill={color}`
   * down to EVERY child path of the lucide glyph, so any same-color stroke
   * lying INSIDE a filled shape becomes invisible. Therefore `fill` is
   * allowed ONLY for true silhouettes — glyphs whose meaning survives as a
   * solid shape with no meaning-bearing interior strokes (Heart, Star,
   * Play, Flame, Folder, Bookmark, …). Never for «кружок + глиф» badges
   * (check / x / alert / play inside a circle), envelopes, cards, cubes,
   * receipts, buildings — those degrade into illegible blobs.
   */
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
  // «Доска заказ-нарядов» (kanban). Ionicons `albums*` has no Lucide twin
  // (Lucide ships `Album`, not `Albums`) so it was rendering a meaningless
  // Circle everywhere it's used (ChecksScreen «Доска» button, WorkBoard /
  // WorkBoardSettings / Users kanban toggle). Every usage in this codebase
  // means the order-narjad board → map to Lucide `Kanban` (columns of cards).
  albums: { lucide: 'Kanban', solid: true },
  'albums-outline': { lucide: 'Kanban' },
  // Кассовая смена / Z-отчёт / сверка кассы. `file-tray-full*` has no Lucide
  // twin → was a Circle. Calculator reads as a cash-register / reconciliation.
  calculator: { lucide: 'Calculator', solid: true },
  'calculator-outline': { lucide: 'Calculator' },
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
  'close-circle': { lucide: 'XCircle', solid: true },
  'close-circle-outline': { lucide: 'XCircle' },
  checkmark: { lucide: 'Check', solid: true },
  // CircleCheck = замкнутый круг + галочка. НЕ 'CheckCircle': в lucide это
  // алиас CircleCheckBig (разорванная дуга), который с fill вырождался в
  // «жирную каплю» — жалоба владельца.
  'checkmark-circle': { lucide: 'CircleCheck', solid: true },
  'checkmark-circle-outline': { lucide: 'CircleCheck' },
  'checkmark-done': { lucide: 'CheckCheck', solid: true },
  'checkmark-done-outline': { lucide: 'CheckCheck' },

  // ── people / accounts ─────────────────────────────────────────────────
  person: { lucide: 'User', solid: true, fill: true },
  'person-outline': { lucide: 'User' },
  // person-circle / people-circle: без fill — заливка внешнего круга прячет
  // фигурку внутри (однотонный диск вместо иконки).
  'person-circle': { lucide: 'CircleUserRound', solid: true },
  'person-circle-outline': { lucide: 'CircleUserRound' },
  people: { lucide: 'Users', solid: true, fill: true },
  'people-outline': { lucide: 'Users' },
  'people-circle': { lucide: 'UsersRound', solid: true },
  'people-circle-outline': { lucide: 'UsersRound' },

  // ── communication ─────────────────────────────────────────────────────
  'call-outline': { lucide: 'Phone' },
  'chatbubble-outline': { lucide: 'MessageSquare' },
  'chatbubble-ellipses': { lucide: 'MessageCircle', solid: true, fill: true },
  'chatbubble-ellipses-outline': { lucide: 'MessageCircle' },
  'chatbubbles-outline': { lucide: 'MessagesSquare' },
  // IntegrationsScreen — карточка «SMS.RU» (единственная падала в Circle-заглушку:
  // имя отсутствовало в карте). Строки текста внутри пузыря — fill НЕ ставим.
  'chatbox-ellipses-outline': { lucide: 'MessageSquareText' },
  'paper-plane-outline': { lucide: 'Send' },
  // Send: линия сгиба проходит внутри корпуса самолётика — fill её прячет.
  send: { lucide: 'Send', solid: true },
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
  receipt: { lucide: 'Receipt', solid: true },
  'storefront-outline': { lucide: 'Store' },

  // ── productivity / docs ───────────────────────────────────────────────
  'clipboard-outline': { lucide: 'Clipboard' },
  'document-text-outline': { lucide: 'FileText' },
  // KnowledgeBaseScreen плитки. «Статьи» (document-text) падала в пустой Circle —
  // у Lucide НЕТ компонента `DocumentText`, и PascalCase-fallback шима его не
  // находил. «Учебный центр» (school) раньше неявно резолвился в здание школы —
  // даём осмысленную «выпускную шапочку» (курсы / аттестация) и явный маппинг.
  'document-text': { lucide: 'FileText', solid: true },
  school: { lucide: 'GraduationCap', solid: true },
  'school-outline': { lucide: 'GraduationCap' },
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
  business: { lucide: 'Building2', solid: true },

  // ── work / tools ──────────────────────────────────────────────────────
  'build-outline': { lucide: 'Wrench' },
  build: { lucide: 'Wrench', solid: true },
  'construct-outline': { lucide: 'Wrench' },
  'cube-outline': { lucide: 'Box' },
  cube: { lucide: 'Box', solid: true },
  'camera-outline': { lucide: 'Camera' },
  camera: { lucide: 'Camera', solid: true },

  // ── status / charts ───────────────────────────────────────────────────
  'analytics-outline': { lucide: 'BarChart3' },
  'stats-chart': { lucide: 'BarChart3', solid: true },
  'bar-chart': { lucide: 'BarChart3', solid: true },
  'bar-chart-outline': { lucide: 'BarChart3' },
  'pie-chart-outline': { lucide: 'PieChart' },
  'pie-chart': { lucide: 'PieChart', solid: true },
  speedometer: { lucide: 'Gauge', solid: true },
  'speedometer-outline': { lucide: 'Gauge' },
  'trending-up': { lucide: 'TrendingUp', solid: true },
  'trending-up-outline': { lucide: 'TrendingUp' },
  'trending-down-outline': { lucide: 'TrendingDown' },
  trophy: { lucide: 'Trophy', solid: true },
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
  // alert-circle / warning: «!» внутри контура — с fill превращались в
  // однотонный диск / сплошной треугольник без восклицательного знака.
  'alert-circle': { lucide: 'AlertCircle', solid: true },
  'information-circle-outline': { lucide: 'Info' },
  warning: { lucide: 'AlertTriangle', solid: true },
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
  // Home: дверь — отдельный штрих внутри контура дома, fill её прятал.
  home: { lucide: 'Home', solid: true },
  journal: { lucide: 'BookOpen', solid: true },
  'link-outline': { lucide: 'Link' },
  'location-outline': { lucide: 'MapPin' },
  'map-outline': { lucide: 'Map' },
  medkit: { lucide: 'BriefcaseMedical', solid: true },
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
  // Без fill: галочка лежит внутри щита, заливка превращала её в блоб.
  'shield-checkmark': { lucide: 'ShieldCheck', solid: true },
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
  images: { lucide: 'Images', solid: true },
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
  // Refresh (включая refresh-circle, который раньше падал в Circle-заглушку).
  refresh: { lucide: 'RefreshCw', solid: true },
  'refresh-circle': { lucide: 'RefreshCw', solid: true },
  // Mail: клапан конверта — штрих внутри прямоугольника, fill его прятал.
  mail: { lucide: 'Mail', solid: true },
  // Location: точка внутри булавки исчезала под заливкой.
  location: { lucide: 'MapPin', solid: true },
  // Time.
  time: { lucide: 'Clock', solid: true },
  // Briefcase / work.
  briefcase: { lucide: 'Briefcase', solid: true, fill: true },
  'briefcase-outline': { lucide: 'Briefcase' },
  // Wallet / card: клапан кошелька и магнитная полоса лежат внутри корпуса —
  // с fill оба вырождались в прямоугольный блоб.
  wallet: { lucide: 'Wallet', solid: true },
  card: { lucide: 'CreditCard', solid: true },
  // Link / hyperlink.
  link: { lucide: 'Link', solid: true },
  // Lock outline.
  'lock-closed-outline': { lucide: 'Lock' },
  // Cog alias for settings.
  cog: { lucide: 'Settings', solid: true },
  'cog-outline': { lucide: 'Settings' },
  // Storefront: дверь рисуется внутри корпуса магазина — fill снят.
  storefront: { lucide: 'Store', solid: true },
  // EquipmentScreen "Форма" section.
  'shirt-outline': { lucide: 'Shirt' },
  shirt: { lucide: 'Shirt', solid: true, fill: true },
  // Play-circle variants (used in admin Activate buttons). Без fill:
  // треугольник лежит внутри круга и исчезал под заливкой.
  'play-circle': { lucide: 'PlayCircle', solid: true },
  'play-circle-outline': { lucide: 'PlayCircle' },
  // Construct (alias of construct-outline).
  construct: { lucide: 'Wrench', solid: true },
  // Document/text variants for sheets.
  document: { lucide: 'FileText', solid: true },
  'document-outline': { lucide: 'FileText' },

  // ── Reports / Salary / Schedule cosmetic-bug audit (2026-05) ───────────
  // Trends → pair the outline variant already present with a solid
  // glyph (used in the Reports HERO when net profit is negative).
  'trending-down': { lucide: 'TrendingDown', solid: true },
  // Picture/image variants — Reports has an "Картинка" export tile that
  // previously fell back to Circle.
  'image-outline': { lucide: 'Image' },
  image: { lucide: 'Image', solid: true },
  // Pulse — used in Reports AI-insights for "revenue up but profit
  // lagging" insight; we previously rendered Circle for it.
  'pulse-outline': { lucide: 'Activity' },
  pulse: { lucide: 'Activity', solid: true },
  // Ribbon — Salary screen "Премии за месяц" section + "Добавить премию"
  // CTA + premium row icon. Was rendering as a Circle blob.
  ribbon: { lucide: 'Ribbon', solid: true },
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
  // chatbubbles: два пузыря перекрываются — заливка заднего закрашивала
  // границу переднего, сливая их в один блоб. chatbox — одиночный замкнутый
  // контур, силуэт чистый, fill остаётся.
  chatbubbles: { lucide: 'MessagesSquare', solid: true },
  chatbox: { lucide: 'MessageSquare', solid: true, fill: true },
  // Active variants of the Mailings tab segmented control + the manual
  // review-request CTA inside MarketingScreen. Без fill — см. `send`.
  'paper-plane': { lucide: 'Send', solid: true },
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

  // ── Round-3 owner audit (2026-06): «кружок» вместо иконки ───────────────
  // Имена, которые проваливались в Circle-заглушку на НОВОЙ функциональности.
  // Подобраны Lucide-двойники, олицетворяющие смысл раздела (не точки).
  // CheckDetailScreen: «Печать / PDF» в шапке + «Чек в ОФД» (внешняя ссылка).
  'print-outline': { lucide: 'Printer' },
  print: { lucide: 'Printer', solid: true },
  // «Открыть в …» / внешняя ссылка: чек ОФД, видео, СБП-ссылка, статьи базы
  // знаний. ExternalLink — стрелка из рамки, однозначный «open external».
  'open-outline': { lucide: 'ExternalLink' },
  open: { lucide: 'ExternalLink', solid: true },
  // «Доска заказ-нарядов» — пустая колонка («Нет заказ-нарядов»). Лоток
  // входящих читается как пустой список. (Сама доска/«Доска» = albums→Kanban,
  // кассовая смена = calculator→Calculator — оба уже реальные глифы.)
  'file-tray-outline': { lucide: 'Inbox' },
  'file-tray': { lucide: 'Inbox', solid: true },
  // «Перенести в папку» (склад, FolderPickerModal / ProductDetailScreen).
  // В этом коде arrow-redo используется ТОЛЬКО как «переместить в папку» →
  // FolderInput (стрелка внутрь папки) точно олицетворяет действие.
  'arrow-redo-outline': { lucide: 'FolderInput' },
  'arrow-redo': { lucide: 'FolderInput', solid: true },
  // История движения товара: исходящее (в брак / б-у) ↔ возврат / приход.
  // Стрелка-в-круге внутри контура — fill НЕ ставим (превратится в блоб).
  'arrow-forward-circle': { lucide: 'CircleArrowRight', solid: true },
  'arrow-forward-circle-outline': { lucide: 'CircleArrowRight' },
  'arrow-undo-circle': { lucide: 'CircleArrowLeft', solid: true },
  'arrow-undo-circle-outline': { lucide: 'CircleArrowLeft' },
  // Перемещение / обмен (журнал движений склада).
  'arrow-swap': { lucide: 'ArrowLeftRight', solid: true },
  // «Ещё» в круге (admin tab bar).
  'ellipsis-horizontal-circle': { lucide: 'CircleEllipsis', solid: true },
  'ellipsis-horizontal-circle-outline': { lucide: 'CircleEllipsis' },
  // Добавить клиента / сотрудника (касса, бронь, быстрый клиент).
  'person-add-outline': { lucide: 'UserPlus' },
  'person-add': { lucide: 'UserPlus', solid: true },
  // Уволить / убрать сотрудника.
  'person-remove-outline': { lucide: 'UserMinus' },
  'person-remove': { lucide: 'UserMinus', solid: true },
  // Прикрепить документ (база знаний). Скрепка — универсальный «attach».
  'document-attach-outline': { lucide: 'Paperclip' },
  'document-attach': { lucide: 'Paperclip', solid: true },
  // Видео-вставки в базе знаний.
  'videocam-outline': { lucide: 'Video' },
  videocam: { lucide: 'Video', solid: true },
  // logo-youtube / logo-vk — у Lucide нет бренд-марок YouTube/VK. YouTube
  // рендерим как Video, VK — как Globe (тот же приём, что logo-google).
  'logo-youtube': { lucide: 'Video', solid: true, fill: false },
  'logo-vk': { lucide: 'Globe', solid: true, fill: false },
  // Звонок (карточки клиента / сотрудника). `call-outline` уже → Phone.
  call: { lucide: 'Phone', solid: true },
  // Тренд вверх (аналитика склада) — алиас trending-up без «-ing».
  'trend-up': { lucide: 'TrendingUp', solid: true },
};

// ── Fill-аудит 2026-06 ───────────────────────────────────────────────────────
// IoniconsShim передаёт `fill={color}` КАЖДОМУ дочернему path lucide-глифа,
// поэтому одноцветные штрихи внутри залитой фигуры становятся невидимыми
// (галочка в круге → «жирная капля», конверт → пустой прямоугольник).
// Правило: `fill: true` оставлен ТОЛЬКО у глифов-силуэтов, проверенных по
// фактическим path'ам в node_modules/lucide-react-native (v1.17.0):
//   • одиночный замкнутый контур: Heart, Star, Play, Flame, Bookmark, Folder,
//     Moon, Funnel, Zap, Shirt, Puzzle, MessageCircle, MessageSquare;
//   • несколько фигур без смыслонесущих штрихов ВНУТРИ заливки: Circle (точка),
//     Pause (два прямоугольника), LayoutGrid (4 плитки с зазорами), Lock (дужка
//     над корпусом), Sun (лучи вне диска), User/Users (голова над телом), Car
//     (колёса по нижней кромке), Bell (язычок ниже купола), Briefcase (ручка
//     над корпусом), SkipBack/SkipForward (планка вне треугольника).
// У всех остальных fill снят: внутренние штрихи (галочка/крест/«!»/двери/окна/
// линзы/линии текста) исчезали под заливкой. Не возвращать fill без проверки
// геометрии глифа.
