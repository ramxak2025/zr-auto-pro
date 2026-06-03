/**
 * Troubleshooting severity → colour + Russian label.
 *
 * Single source of truth so the list row, the detail header and any future
 * filters all read the same way.
 */
import { colors } from '../../theme';
import type { TroubleshootingSeverity } from '../../../../shared/types';

export interface SeverityStyle {
  label: string;
  /** Solid/strong colour for text + icon. */
  color: string;
  /** Soft background tint for chips. */
  bg: string;
}

export function severityStyle(severity?: TroubleshootingSeverity): SeverityStyle | null {
  switch (severity) {
    case 'high':
      return { label: 'Критично', color: colors.red[600], bg: colors.red[50] };
    case 'med':
      return { label: 'Средне', color: colors.amber[600], bg: colors.amber[50] };
    case 'low':
      return { label: 'Низкое', color: colors.green[600], bg: colors.green[50] };
    default:
      return null;
  }
}
