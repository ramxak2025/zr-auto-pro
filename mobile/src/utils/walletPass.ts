// ═══════════════════════════════════════════════════════════════════════════
//  Apple Wallet — запись подписанного .pkpass во временный файл и показ
//  системного листа «Добавить в Apple Wallet».
//
//  Сам .pkpass строится и PKCS#7-подписывается на БЭКЕНДЕ (passkit-generator +
//  сертификат Apple Pass Type ID тенанта). Клиент только скачивает байты
//  (GET /wallet/pass/:id, application/vnd.apple.pkpass), кладёт их во временный
//  файл и отдаёт системе — iOS сам предлагает добавить карту в Wallet.
//
//  expo-file-system (legacy API) и expo-sharing поднимаются ЛЕНИВО через guarded
//  require: до батч-prebuild нативные модули ExpoFileSystem / ExpoSharing не
//  слинкованы, и обычный top-level import уронил бы экран на старте. Тот же
//  контракт, что в orderPdf.ts: если модуль не найден — мягкий алерт «доступно
//  после обновления приложения» вместо краша.
//
//  До настройки сертификата на сервере GET /wallet/pass/:id отдаёт 422 — это
//  ловит caller (ClientDetailScreen) и показывает понятный текст. Кнопка вообще
//  показывается только когда WalletSettings.configured === true.
// ═══════════════════════════════════════════════════════════════════════════

// expo-file-system/legacy резолвится через корневой legacy.ts (без exports-map),
// поэтому описываем РОВНО ту поверхность, что используем — без зависимости от
// разрешения типов сабпате.
type LegacyFileSystem = {
  cacheDirectory: string | null;
  writeAsStringAsync: (fileUri: string, contents: string, options?: { encoding?: 'base64' | 'utf8' }) => Promise<void>;
};

function showAlert(title: string, message: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Alert } = require('react-native') as typeof import('react-native');
    Alert.alert(title, message);
  } catch {
    /* вне RN-окружения (тесты) — no-op */
  }
}

/**
 * Blob (application/vnd.apple.pkpass) → base64 без префикса data-URL.
 * RN FileReader.readAsDataURL — единственный надёжный способ вытащить байты из
 * нативного Blob (у RN-Blob нет .arrayBuffer()).
 */
export function pkpassBlobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать карту'));
      reader.onloadend = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        // "data:application/vnd.apple.pkpass;base64,XXXX" → "XXXX"
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      reject(e instanceof Error ? e : new Error('Не удалось прочитать карту'));
    }
  });
}

/**
 * Пишет .pkpass (в base64) во временный файл и открывает системный лист, где
 * iOS предлагает «Добавить в Apple Wallet».
 *
 * Возвращает:
 *   • true  — лист показан;
 *   • false — нативные модули ещё не слинкованы / share недоступен
 *             (показан мягкий алерт, краша нет).
 *
 * Бросает ТОЛЬКО при ошибке записи файла — её ловит caller и показывает
 * «Ошибка». Отмена самого share-листа НЕ ошибка (файл уже готов, лист
 * открылся) и здесь глушится.
 */
export async function presentPkpass(base64: string, fileName: string): Promise<boolean> {
  let FileSystem: LegacyFileSystem;
  let Sharing: typeof import('expo-sharing');
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    FileSystem = require('expo-file-system/legacy') as LegacyFileSystem;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sharing = require('expo-sharing');
    if (typeof FileSystem?.writeAsStringAsync !== 'function') throw new Error('ExpoFileSystem not linked');
  } catch {
    showAlert('Недоступно', 'Apple Wallet станет доступен после обновления приложения.');
    return false;
  }

  const dir = FileSystem.cacheDirectory;
  if (!dir) {
    showAlert('Ошибка', 'Нет доступа к временной папке.');
    return false;
  }

  const fileUri = `${dir}${fileName}`;
  // Запись может упасть (нет места и т.п.) — пробрасываем, caller покажет «Ошибка».
  await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: 'base64' });

  if (!(await Sharing.isAvailableAsync())) {
    showAlert('Готово', 'Карта создана, но системный лист недоступен на этом устройстве.');
    return false;
  }

  try {
    await Sharing.shareAsync(fileUri, {
      UTI: 'com.apple.pkpass',
      mimeType: 'application/vnd.apple.pkpass',
      dialogTitle: 'Карта лояльности',
    });
  } catch {
    /* пользователь закрыл/отменил лист — это не ошибка */
  }
  return true;
}
