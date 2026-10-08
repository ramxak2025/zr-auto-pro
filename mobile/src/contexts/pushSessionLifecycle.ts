import type { AccountKeyValueStorage } from './accountRegistry';
import { tokenIdentity, accountId } from './accountRegistry';

export const PUSH_CLAIM_KEY = 'autexa.auth.push-claim.v1';
interface PushClaim {
  v: 1;
  bearer: string;
  deviceToken: string;
  platform: 'ios' | 'android';
}
interface PushTransport {
  register(claim: PushClaim): Promise<{ registered?: boolean }>;
  unregister(claim: PushClaim): Promise<void>;
  logout?(bearer: string): Promise<void>;
}

/** One device subscription, including a possibly committed response that was
 * lost. Credentials stay in SecureStore. The serial tail orders an in-flight
 * A registration, A deletion and B registration; no late cleanup can delete B.
 * Failed cleanup is retained and blocks registration, not account switching. */
export function createPushSessionLifecycle(storage: AccountKeyValueStorage, transport: PushTransport) {
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = tail.catch(() => {}).then(work);
    tail = result.catch(() => {});
    return result;
  };
  const read = async (): Promise<PushClaim | null> => {
    const raw = await storage.getItem(PUSH_CLAIM_KEY);
    if (raw === null) return null;
    const claim = JSON.parse(raw) as PushClaim;
    if (claim.v !== 1 || !claim.bearer || !claim.deviceToken || !['ios', 'android'].includes(claim.platform))
      throw new Error('Не удалось прочитать привязку уведомлений.');
    return claim;
  };
  const clear = async () => {
    await storage.removeItem(PUSH_CLAIM_KEY);
    if ((await storage.getItem(PUSH_CLAIM_KEY)) !== null) throw new Error('Не удалось сохранить отвязку уведомлений.');
  };
  const release = async (claim: PushClaim) => {
    await transport.unregister(claim);
    await clear();
  };
  const sameActor = (left: string, right: string) => {
    const a = tokenIdentity(left)?.identity;
    const b = tokenIdentity(right)?.identity;
    return !!a && !!b && accountId(a) === accountId(b);
  };
  return {
    register: (bearer: string, deviceToken: string, platform: PushClaim['platform'], isCurrent: () => boolean) =>
      serial(async () => {
        if (!isCurrent()) return;
        const previous = await read();
        if (!isCurrent()) return;
        if (previous) await release(sameActor(previous.bearer, bearer) ? { ...previous, bearer } : previous);
        if (!isCurrent()) return;
        const claim: PushClaim = { v: 1, bearer, deviceToken, platform };
        const raw = JSON.stringify(claim);
        await storage.setItem(PUSH_CLAIM_KEY, raw);
        if ((await storage.getItem(PUSH_CLAIM_KEY)) !== raw)
          throw new Error('Не удалось сохранить привязку уведомлений.');
        if (!isCurrent()) {
          await clear();
          return;
        }
        const result = await transport.register(claim);
        // Refusal is authoritative, but keep the claim after a transport error:
        // the POST may have committed and must be removed before the next owner.
        if (result.registered === false) await clear();
        else if (!isCurrent()) await release(claim);
      }),
    detach: () =>
      serial(async () => {
        const previous = await read();
        if (previous) await release(previous);
      }),
    logout: (bearer: string, wasActive = false) =>
      serial(async () => {
        const previous = await read();
        if (previous && (previous.bearer === bearer || (wasActive && sameActor(previous.bearer, bearer))))
          await release({ ...previous, bearer });
        await transport.logout?.(bearer);
      }),
  };
}
