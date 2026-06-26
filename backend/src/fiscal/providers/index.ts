import { FiscalProvider, FiscalProviderName } from './fiscal-provider.interface';
import { AtolProvider } from './atol.provider';

export * from './fiscal-provider.interface';

// Providers hold only a per-account token cache (no per-call state), so a single
// shared instance is enough — and the cache is reused across requests.
const REGISTRY: Record<FiscalProviderName, FiscalProvider> = {
  atol: new AtolProvider(),
};

/** Resolve the adapter for a provider name. Defaults to АТОЛ (the only impl). */
export function getFiscalProvider(_name: FiscalProviderName | string | null | undefined): FiscalProvider {
  return REGISTRY.atol;
}
