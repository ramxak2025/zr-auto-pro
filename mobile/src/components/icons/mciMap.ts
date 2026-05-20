/**
 * MaterialCommunityIcons-name → Lucide component name + visual hint.
 * Mirror of `ioniconsMap.ts` but for the MCI naming the platform/Icon
 * abstraction uses on Android. See ioniconsMap.ts for the broader
 * rationale (avoid font-glyph rendering — render SVG paths instead).
 */
import type { IconMapEntry } from './ioniconsMap';

export const MCI_TO_LUCIDE: Record<string, IconMapEntry> = {
  // people
  'account-outline': { lucide: 'User' },
  'account-multiple-outline': { lucide: 'Users' },

  // status / system
  'alert-outline': { lucide: 'AlertTriangle' },
  'bell-outline': { lucide: 'Bell' },
  'bullhorn-outline': { lucide: 'Megaphone' },
  'information-outline': { lucide: 'Info' },
  'shield-outline': { lucide: 'Shield' },
  'shield-check-outline': { lucide: 'ShieldCheck' },
  'lock-outline': { lucide: 'Lock' },
  'eye-outline': { lucide: 'Eye' },
  'eye-off-outline': { lucide: 'EyeOff' },

  // ui
  check: { lucide: 'Check', solid: true },
  close: { lucide: 'X', solid: true },
  plus: { lucide: 'Plus', solid: true },
  'plus-circle-outline': { lucide: 'PlusCircle' },
  'chevron-down': { lucide: 'ChevronDown', solid: true },
  'chevron-left': { lucide: 'ChevronLeft', solid: true },
  'chevron-right': { lucide: 'ChevronRight', solid: true },
  magnify: { lucide: 'Search' },
  logout: { lucide: 'LogOut' },
  'view-grid': { lucide: 'LayoutGrid', solid: true, fill: true },

  // money / cards
  'credit-card-outline': { lucide: 'CreditCard' },
  'wallet-outline': { lucide: 'Wallet' },
  receipt: { lucide: 'Receipt', solid: true, fill: true },
  'text-box': { lucide: 'FileText', solid: true, fill: true },

  // home / store / building
  home: { lucide: 'Home', solid: true, fill: true },
  'office-building-outline': { lucide: 'Building2' },
  'package-variant-closed': { lucide: 'Package', solid: true, fill: true },
  'cube-outline': { lucide: 'Box' },

  // vehicles
  'car-outline': { lucide: 'Car' },
  'truck-outline': { lucide: 'Truck' },

  // tools
  'wrench-outline': { lucide: 'Wrench' },
  'cog-outline': { lucide: 'Settings' },
  'phone-outline': { lucide: 'Phone' },
  'camera-outline': { lucide: 'Camera' },
  'calendar-outline': { lucide: 'Calendar' },
  'clock-outline': { lucide: 'Clock' },
  'star-outline': { lucide: 'Star' },

  // analytics
  'chart-bar': { lucide: 'BarChart3', solid: true },
  'trending-up': { lucide: 'TrendingUp', solid: true },
  'trending-down': { lucide: 'TrendingDown', solid: true },

  // swap
  'swap-horizontal': { lucide: 'ArrowLeftRight', solid: true },
};
