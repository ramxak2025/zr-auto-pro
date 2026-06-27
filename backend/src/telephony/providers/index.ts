import { TelephonyProvider, TelephonyProviderName } from './telephony-provider.interface';
import { MangoProvider } from './mango.provider';

export * from './telephony-provider.interface';

// Providers are stateless (credentials are passed per-call), so a single shared
// instance is enough — no per-request allocation.
const REGISTRY: Record<TelephonyProviderName, TelephonyProvider> = {
  mango: new MangoProvider(),
};

/** Resolve the adapter for a provider name. Defaults to Mango (the only one). */
export function getTelephonyProvider(_name: TelephonyProviderName | string | null | undefined): TelephonyProvider {
  return REGISTRY.mango;
}
