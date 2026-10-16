import { captureAuthSession, createSessionBoundClient } from '../../api/axios';
import { captureDataSession } from '../../contexts/dataSession';
import { createManagerCabinetApi, createTenantsApi } from '../../../../shared/api/createServices';
export function captureRenewalSession() {
  const auth = captureAuthSession(),
    data = captureDataSession();
  const client = createSessionBoundClient(auth.token);
  return {
    data,
    isCurrent: () => auth.isCurrent() && data.isCurrent(),
    manager: createManagerCabinetApi(client),
    tenants: createTenantsApi(client),
  };
}
export type RenewalSession = ReturnType<typeof captureRenewalSession>;
