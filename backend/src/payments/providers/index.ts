import { PaymentProvider, PaymentProviderName } from './payment-provider.interface';
import { YooKassaProvider } from './yookassa.provider';
import { TinkoffProvider } from './tinkoff.provider';

export * from './payment-provider.interface';

// Providers are stateless (credentials are passed per-call), so a single shared
// instance of each is enough — no per-request allocation.
const REGISTRY: Record<PaymentProviderName, PaymentProvider> = {
  yookassa: new YooKassaProvider(),
  tinkoff: new TinkoffProvider(),
};

/** Resolve the adapter for a provider name. Defaults to ЮKassa for safety. */
export function getProvider(name: PaymentProviderName | string | null | undefined): PaymentProvider {
  if (name === 'tinkoff') return REGISTRY.tinkoff;
  return REGISTRY.yookassa;
}
