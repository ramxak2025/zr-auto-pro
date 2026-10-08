import { captureAuthSession, createSessionBoundClient } from '../../api/axios';
import { captureDataSession } from '../../contexts/dataSession';
import {
  createBookingsApi,
  createCheckPhotosApi,
  createChecksApi,
  createLoyaltyApi,
} from '../../../../shared/api/createServices';

/** Capture once at the start of a saved-check continuation or native picker.
 * Never recapture after an await: identical JWTs can belong to a new epoch. */
export function captureCheckSaveSession() {
  const auth = captureAuthSession();
  const data = captureDataSession();
  const client = createSessionBoundClient(auth.token);
  return {
    data,
    isCurrent: () => auth.isCurrent() && data.isCurrent(),
    photos: createCheckPhotosApi(client),
    bookings: createBookingsApi(client),
    checks: createChecksApi(client),
    loyalty: createLoyaltyApi(client),
  };
}
