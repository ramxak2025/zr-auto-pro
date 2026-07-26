/**
 * networkDiagnosis — отличает «нет интернета» от «интернет есть, но не
 * разрешаются имена».
 *
 * ЗАЧЕМ: у владельца рецидивом шло «иногда с ВПН не работает», и приложение
 * показывало красное «Нет подключения к интернету». 26.07.2026 механизм пойман
 * живьём (iOS-симулятор, VPN-клиент Happ на utun10): с хоста ВСЕ три хоста
 * кольца отвечали 200, а внутри устройства даже Safari писал «не удаётся найти
 * сервер»; тот же сервер по IP (`https://212.8.229.254`) открывался — TLS
 * поднимался, ругался только на несовпадение имени в сертификате. То есть
 * маршрут и TLS живы, ломается ИМЕННО разрешение имён.
 *
 * Почему это не лечится кольцом хостов: кольцо перебирает ИМЕНА
 * (autexa.pw → autexa-cloud.ru → Яндекс-шлюз). Когда мёртв DNS, все три
 * умирают одновременно, и нейтральные пробы (ya.ru / captive.apple.com /
 * gstatic) — тоже, потому что они тоже по именам. Диагноз «нет интернета»
 * формально следовал из проб, но по сути врал: сеть работала, и пользователь
 * искал проблему в приложении или на сервере.
 *
 * КАК ЛОВИМ БЕЗ НАТИВА: DoH-эндпоинты Cloudflare и Google доступны по
 * IP-литералам, и их сертификаты валидны на сам адрес (1.1.1.1 / 8.8.8.8).
 * Значит такой запрос не нуждается в DNS вообще. Если по именам не прошло
 * ничего, а по IP-литералу прошло — сеть жива, виноват DNS (обычно VPN-клиент
 * с перехватом DNS или фильтрация провайдера).
 *
 * Диагноз ставится только по ПОЛОЖИТЕЛЬНОМУ доказательству: если IP-проба
 * тоже молчит (в РФ «жёсткие окна» режут и Cloudflare, и Google), возвращаем
 * прежний вердикт 'no-internet' — поведение до этой правки не меняется.
 */
import { isHtmlApiPayload } from '../api/apiHosts';

/** Проверка ответа пробы: сам решает, что считать успехом. Может читать тело. */
export type ProbeValidate = (res: Response) => Promise<boolean> | boolean;

export type Probe = {
  url: string;
  validate: ProbeValidate;
  /** DoH требует явного Accept — без него отдаётся не JSON. */
  headers?: Record<string, string>;
};

/** Вердикт: что на самом деле со связью, когда API недоступен. */
export type ConnectivityVerdict =
  /** Интернет есть по именам — значит недоступен именно наш сервер. */
  | 'internet-ok'
  /** Сеть жива (дошли по IP), но имена не разрешаются — VPN/DNS. */
  | 'dns-blocked'
  /** Не прошло ничего — сети нет. */
  | 'no-internet';

/**
 * Находка ревью 05.07: HTML-заглушка со статусом 200 (captive-portal, чужой
 * апстрим) «оздоравливала» пробу. Валидируем тело тем же стражем, что и axios.
 */
export const notHtmlOk: ProbeValidate = async (res) => {
  if (!res.ok) return false;
  const body = await res.text().catch(() => '');
  return !isHtmlApiPayload(body, res.headers.get('content-type'));
};

/**
 * Нейтральные пробы «интернет вообще есть?». Достаточно ЛЮБОГО успеха.
 * Первым — Яндекс: в регионах с «белыми списками» (Дагестан и т. п.)
 * операторы в жёсткие окна режут ВСЁ иностранное — Apple/Google молчат, и
 * баннер врал «нет соединения», хотя российский интернет работал. Российская
 * проба обязана стоять в списке, иначе диагноз в этих окнах всегда ложный.
 * Apple captive probe и gstatic — резервы (вне РФ и на «чистых» сетях).
 *
 * У каждой пробы СВОЙ критерий успеха: captive-Wi-Fi подсовывает свою
 * HTML-страницу со статусом 200 на любой URL — голый `res.ok` считал такую
 * сеть «интернетом», и баннер вместо честного красного «нет интернета»
 * показывал оранжевый «сервер недоступен». robots.txt Яндекса — не HTML;
 * настоящий ответ Apple-пробы содержит слово Success; generate_204 обязан
 * ответить именно 204.
 *
 * ВАЖНО: все эти пробы идут по ИМЕНАМ — именно поэтому их общий провал ещё не
 * доказывает отсутствие сети (см. DNS_BYPASS_PROBES).
 */
export const NEUTRAL_PROBES: ReadonlyArray<Probe> = [
  { url: 'https://ya.ru/robots.txt', validate: notHtmlOk },
  {
    url: 'https://captive.apple.com/hotspot-detect.html',
    validate: async (res) => res.ok && (await res.text().catch(() => '')).includes('Success'),
  },
  { url: 'https://www.gstatic.com/generate_204', validate: (res) => res.status === 204 },
];

/**
 * Пробы, которым DNS не нужен: адрес задан IP-литералом, а сертификат у этих
 * резолверов валиден на сам IP, поэтому TLS проходит без имени.
 *
 * Успехом считаем ЛЮБОЙ разобранный DoH-ответ: даже отрицательный ответ
 * (`Status !== 0`) доказывает, что пакеты ходят — а нам нужно именно это.
 * Спрашиваем наш собственный домен: попутно видно, что резолвинг как таковой
 * работает, когда системный путь его не даёт.
 */
export const DNS_BYPASS_PROBES: ReadonlyArray<Probe> = [
  {
    url: 'https://1.1.1.1/dns-query?name=autexa.pw&type=A',
    headers: { accept: 'application/dns-json' },
    validate: isDohAnswer,
  },
  {
    url: 'https://8.8.8.8/resolve?name=autexa.pw&type=A',
    headers: { accept: 'application/json' },
    validate: isDohAnswer,
  },
];

/** DoH-ответ разобрался в JSON с полем Status — сеть доказуемо живая. */
async function isDohAnswer(res: Response): Promise<boolean> {
  if (!res.ok) return false;
  try {
    const body = await res.text();
    const parsed = JSON.parse(body) as { Status?: unknown } | null;
    return !!parsed && typeof parsed === 'object' && typeof parsed.Status === 'number';
  } catch {
    return false;
  }
}

/** GET с таймаутом; никогда не бросает — только true/false. */
export function probeUrl(
  url: string,
  timeoutMs: number,
  validate: ProbeValidate = (res) => res.ok,
  parentSignal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<boolean> {
  const abort = new AbortController();
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', forwardAbort);
      resolve(result);
    };
    function forwardAbort() {
      abort.abort();
      finish(false);
    }

    // Resolve the wrapper itself on the deadline. Some native fetch adapters
    // only treat AbortController as a hint and may otherwise hang forever.
    const timer = setTimeout(forwardAbort, timeoutMs);
    if (parentSignal?.aborted) {
      forwardAbort();
      return;
    }
    parentSignal?.addEventListener('abort', forwardAbort, { once: true });
    void (async () => {
      try {
        const res = await fetch(url, { method: 'GET', signal: abort.signal, headers });
        finish(await validate(res));
      } catch {
        finish(false);
      }
    })();
  });
}

/** true — первая же проба прошла свой критерий; false — все нет. Не бросает. */
export function anyReachable(probes: ReadonlyArray<Probe>, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  if (probes.length === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let remaining = probes.length;
    let settled = false;
    for (const probe of probes) {
      void probeUrl(probe.url, timeoutMs, probe.validate, signal, probe.headers).then((ok) => {
        if (settled) return;
        if (ok) {
          settled = true;
          resolve(true);
          return;
        }
        remaining -= 1;
        if (remaining === 0) {
          settled = true;
          resolve(false);
        }
      });
    }
  });
}

/**
 * Вердикт о сети, когда API уже признан недоступным.
 *
 * Порядок намеренный и экономный: сначала имена (в норме первая же проба
 * отвечает, и вторая ступень не запускается вовсе), и только при их полном
 * провале — дорогая проверка «а по IP-то ходит?».
 */
export async function diagnoseConnectivity(timeoutMs: number, signal?: AbortSignal): Promise<ConnectivityVerdict> {
  const namesOk = await anyReachable(NEUTRAL_PROBES, timeoutMs, signal);
  if (namesOk) return 'internet-ok';
  if (signal?.aborted) return 'no-internet';
  const rawIpOk = await anyReachable(DNS_BYPASS_PROBES, timeoutMs, signal);
  return rawIpOk ? 'dns-blocked' : 'no-internet';
}
