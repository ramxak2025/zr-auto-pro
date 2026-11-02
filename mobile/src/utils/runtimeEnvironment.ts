import Constants from 'expo-constants';

// Embedded by the exact native build selector. Never inferred from a server,
// account, saved host hint, or user preference. Captured once per JS process.
export const inventoryInternal = Constants?.expoConfig?.extra?.inventoryInternal === 'ios-v1';
export const INVENTORY_INTERNAL_API_HOSTS = ['https://autexa.pw:8443/api', 'https://autexa-cloud.ru:8443/api'] as const;
export const environmentStoragePrefix = inventoryInternal ? 'autexa_inventory_internal_v1.' : '';

/** Absolute URLs bypass axios baseURL; reject them outside the isolated API. */
export function isInventoryInternalRequestUrl(url: string | undefined): boolean {
  if (!url) return true;
  if (/^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//') || url.includes('\\')) {
    return INVENTORY_INTERNAL_API_HOSTS.some(
      (base) => url === base || url.startsWith(base + '/') || url.startsWith(base + '?'),
    );
  }
  return true;
}
