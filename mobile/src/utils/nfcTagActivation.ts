import type { AttendanceNfcTag } from '../../../shared/types';
import { parseAttendanceNfcUri } from '../../../shared/utils/attendanceNfcUri';

/** Both initial enrollment and recovery use a fresh physical read plus the
 * server's owner/point/token-hash checks. Raw tokens never enter list caches. */
export async function runNfcTagActivation(options: {
  tagId: string;
  expectedToken?: string;
  isCurrent: () => boolean;
  read: () => Promise<string>;
  activate: (id: string, token: string) => Promise<AttendanceNfcTag>;
  onActivating: () => void;
}): Promise<AttendanceNfcTag | null> {
  if (!options.isCurrent()) return null;
  const uri = await options.read();
  if (!options.isCurrent()) return null;
  const parsed = parseAttendanceNfcUri(uri);
  if (!parsed || (options.expectedToken && parsed.token !== options.expectedToken))
    throw new Error('Прочитанная метка не совпадает с ожидаемой. Приложите нужную метку и повторите.');
  options.onActivating();
  if (!options.isCurrent()) return null;
  const activated = await options.activate(options.tagId, parsed.token);
  if (!options.isCurrent()) return null;
  if (activated.id !== options.tagId || activated.status !== 'active')
    throw new Error('Сервер не подтвердил активацию. Повторите проверку метки.');
  return activated;
}
