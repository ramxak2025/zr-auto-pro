/**
 * Страж КОНФИГА кольца хостов (а не его механики — та в apiHosts.test.ts).
 *
 * ЗАЧЕМ отдельный тест на app.json: механизм failover ни разу не был причиной
 * аварий, а вот СПИСОК хостов ломали дважды.
 *   • 05.07.2026 — из кольца выкинули единственный доступный владельцу хост
 *     (autexa.pw), кольцо осталось из двух недостижимых адресов;
 *   • тогда же резервы записывали без пути `/api`, и запросы уезжали в корень
 *     домена: GET получал SPA-HTML со статусом 200, POST — 405.
 *
 * 26.07.2026 добавлен четвёртый рубеж — вход по IP-литералу. Он существует
 * ровно для случая, когда сломано разрешение имён (VPN с перехватом DNS,
 * фильтрация оператора): кольцо перебирает ИМЕНА, поэтому при мёртвом DNS все
 * домены умирают одновременно, а адрес — нет. У сервера для этого выпущен
 * сертификат Let's Encrypt на сам IP (профиль shortlived).
 */
import { buildApiHosts, apiPathOf } from '../apiHosts';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const appJson = require('../../../app.json') as {
  expo: { extra: { apiUrl: string; apiFallbackUrls: string[] } };
};

const { apiUrl, apiFallbackUrls } = appJson.expo.extra;
const IP_ENTRY = 'https://212.8.229.254/api';

describe('конфиг кольца хостов в app.json', () => {
  it('primary — живой домен autexa.pw', () => {
    expect(apiUrl).toBe('https://autexa.pw/api');
  });

  it('в кольце есть все четыре независимых пути', () => {
    const hosts = buildApiHosts(apiUrl, apiFallbackUrls);
    expect(hosts).toEqual([
      'https://autexa.pw/api',
      'https://autexa-cloud.ru/api',
      'https://d5dpq4hcfoor5l4q1a97.wnq2w1o5.apigw.yandexcloud.net/api',
      IP_ENTRY,
    ]);
  });

  it('вход по IP стоит ПОСЛЕДНИМ — обычный трафик идёт по именам', () => {
    expect(apiFallbackUrls[apiFallbackUrls.length - 1]).toBe(IP_ENTRY);
  });

  it('у каждого хоста кольца есть путь /api (страж инцидента 05.07)', () => {
    for (const host of buildApiHosts(apiUrl, apiFallbackUrls)) {
      expect(apiPathOf(host)).toBe('/api');
    }
  });

  it('хосты в кольце не дублируются', () => {
    const hosts = buildApiHosts(apiUrl, apiFallbackUrls);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('IP-вход задан именно литералом адреса — иначе он бессмысленен', () => {
    expect(IP_ENTRY).toMatch(/^https:\/\/(\d{1,3}\.){3}\d{1,3}\/api$/);
  });
});
