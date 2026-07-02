import { Controller, Get, Header } from '@nestjs/common';

/**
 * GET /api/client-version — публичная «минимальная версия клиента»
 * (мягкий kill-switch для мобильных сборок).
 *
 * Зачем: JS-фиксы доезжают по OTA (EAS Updates), но сломанный NATIVE-слой
 * так не починить. Выставив MIN_IOS_BUILD / MIN_ANDROID_BUILD, владелец
 * показывает сборкам старше минимума блокирующий экран «Нужно обновление»
 * (mobile/src/components/UpdateGate.tsx) вместо тихой порчи учёта.
 *
 * Контракт:
 *   • ПУБЛИЧНЫЙ, без JWT — как /health: guard'ов на контроллере нет
 *     (JwtAuthGuard в этом проекте вешается по-контроллерно, глобален только
 *     RateLimitGuard — его read-bucket 600/min этому эндпоинту не мешает).
 *     Гейт должен работать и до логина.
 *   • Всё из env, читается на каждый запрос (дёшево — три строки из
 *     process.env; изменение env всё равно требует рестарта контейнера):
 *       MIN_IOS_BUILD        — минимальный iOS buildNumber (дефолт 0 = выкл);
 *       MIN_ANDROID_BUILD    — минимальный Android versionCode (дефолт 0 = выкл);
 *       IOS_UPDATE_URL       — куда ведёт «Обновить» на iOS
 *                              (дефолт — публичная ссылка TestFlight);
 *       ANDROID_UPDATE_URL   — куда ведёт «Обновить» на Android (дефолт пусто —
 *                              кнопка скрыта);
 *       CLIENT_UPDATE_MESSAGE — необязательный текст на блок-экране.
 *   • Дефолт 0/0 делает эндпоинт инертным: клиент никогда не блокируется,
 *     пока владелец явно не выставит минимум.
 *   • Cache-Control: public, max-age=300 — nginx/CDN и клиентские кеши могут
 *     держать ответ 5 минут; kill-switch не обязан срабатывать мгновенно,
 *     зато обходится серверу почти бесплатно при любом фан-ауте клиентов.
 *   • Мусор в env (не-число, отрицательное) нормализуется в 0 — кривой
 *     деплой env никогда не выльется в массовую ложную блокировку.
 */
@Controller('client-version')
export class ClientVersionController {
  @Get()
  @Header('Cache-Control', 'public, max-age=300')
  getClientVersion(): {
    minIosBuild: number;
    minAndroidBuild: number;
    iosUrl: string;
    androidUrl: string;
    message?: string;
  } {
    const minIosBuild = this.envMinBuild('MIN_IOS_BUILD');
    const minAndroidBuild = this.envMinBuild('MIN_ANDROID_BUILD');
    const iosUrl = process.env.IOS_UPDATE_URL || 'https://testflight.apple.com/join/JfDQTjJ2';
    const androidUrl = process.env.ANDROID_UPDATE_URL || '';
    const message = (process.env.CLIENT_UPDATE_MESSAGE || '').trim();

    return {
      minIosBuild,
      minAndroidBuild,
      iosUrl,
      androidUrl,
      ...(message ? { message } : {}),
    };
  }

  /** env → положительное целое; отсутствие/мусор/≤0 → 0 (= выключено). */
  private envMinBuild(name: string): number {
    const raw = process.env[name];
    if (!raw) return 0;
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
}
