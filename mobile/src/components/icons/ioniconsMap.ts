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

  // ── arrows ────────────────────────────────────────────────────────────
  'arrow-back': { lucide: 'ArrowLeft', solid: true },
  'arrow-forward': { lucide: 'ArrowRight', solid: true },
  'arrow-up': { lucide: 'ArrowUp', solid: true },
  'arrow-down': { lucide: 'ArrowDown', solid: true },
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
  'today-outline': { lucide: 'CalendarDays' },
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
  'eye-outline': { lucide: 'Eye' },
  'eye-off-outline': { lucide: 'EyeOff' },
  'refresh-outline': { lucide: 'RefreshCw' },
  'ellipsis-horizontal': { lucide: 'MoreHorizontal', solid: true },
  'ellipsis-vertical': { lucide: 'MoreVertical', solid: true },
};
