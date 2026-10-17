import { captureAuthSession, createSessionBoundClient } from '../../api/axios';
import { captureDataSession } from '../../contexts/dataSession';
import { createAdminApi, createManagerCabinetApi, createTenantsApi } from '../../../../shared/api/createServices';
/** Bind before dispatch; a replacement account can never adopt this request. */
export function capturePlatformSession() {
  const auth = captureAuthSession(),
    data = captureDataSession();
  const client = createSessionBoundClient(auth.token);
  return {
    data,
    authEpoch: auth.epoch,
    isCurrent: () => auth.isCurrent() && data.isCurrent(),
    manager: createManagerCabinetApi(client),
    tenants: createTenantsApi(client),
    admin: createAdminApi(client),
  };
}
export function assertPlatformSession(session: ReturnType<typeof capturePlatformSession>, authorized = true) {
  if (!authorized || !session.isCurrent())
    throw Object.assign(new Error('Сессия изменилась'), { code: 'ERR_CANCELED' });
}
