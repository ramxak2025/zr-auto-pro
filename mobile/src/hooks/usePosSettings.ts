/**
 * usePosSettings — single source for the tenant's «Режим кассовой смены»
 * capability of the CURRENT caller (092). Reads GET /checks/pos-settings once
 * (cached, SWR) and exposes the only derived flag every UI branch keys off:
 * `orderMode`.
 *
 * CRITICAL — byte-for-byte OFF guarantee: when the mode is OFF (the default)
 * OR while the query is still loading, `shiftModeEnabled` resolves to `false`
 * and `isCashier` to `true`, so `orderMode` is `false` and EVERY consumer
 * short-circuits to the exact legacy behaviour. Nothing swaps until we
 * positively know the caller is a NON-cashier under an ENABLED shift-mode.
 *
 *   • shiftModeEnabled — owner flipped «Режим кассовой смены» on for the tenant.
 *   • isCashier        — the caller can take payment (owner-class role OR the
 *                        `accept_payment` permission). Resolved server-side.
 *   • orderMode        — shiftModeEnabled && !isCashier → a master who creates
 *                        заказ-наряды and works the board, but never pробивает
 *                        оплату. THIS is the flag the tab bar / CheckCreate use.
 *
 * GET is readable by any authenticated tenant user, so this is safe to call
 * from the tab bar for masters and directors alike.
 */
import { useQuery } from '@tanstack/react-query';
import { checksApi } from '../api/services';
import type { PosSettings } from '../../../shared/types';

export const POS_SETTINGS_KEY = ['checks', 'pos-settings'] as const;

export function usePosSettings() {
  const query = useQuery<PosSettings>({
    queryKey: POS_SETTINGS_KEY,
    queryFn: async () => (await checksApi.getPosSettings()).data,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  // Defaults below are the OFF state — see the byte-for-byte guarantee above.
  const shiftModeEnabled = query.data?.shiftModeEnabled ?? false;
  const isCashier = query.data?.isCashier ?? true;
  const orderMode = shiftModeEnabled && !isCashier;

  return { ...query, shiftModeEnabled, isCashier, orderMode };
}
