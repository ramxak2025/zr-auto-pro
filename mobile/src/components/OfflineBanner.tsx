/**
 * OfflineBanner — умный сетевой баннер (Round 9), вместо прежней «просто
 * красной полосы „Нет соединения"».
 *
 * ЗАЧЕМ: в сети автосервиса владельца оператор фильтрует домен API — интернет
 * на телефоне ЕСТЬ (NetInfo молчит), но сервер недостижим. Старый баннер в
 * этом случае не показывался вовсе, и отказы выглядели как «приложение
 * сломалось». Новый различает две ситуации дуальной пробой:
 *
 *   1. Общий host-selector гоняет /health по ВСЕМ хостам
 *      failover-кольца и принимает первый здоровый — API доступен?
 *   2. Нейтральная достижимость (ya.ru / captive.apple.com / gstatic
 *      generate_204, 6 с) — интернет вообще есть?
 *
 * Исходы:
 *   • API ok → баннер скрыт (это был кратковременный сбой);
 *   • оба недоступны → «Нет подключения к интернету» (красный);
 *   • интернет есть, API нет → «Сервер недоступен в вашей сети — попробуйте
 *     Wi-Fi или VPN» (оранжевый) — случай операторской фильтрации, без
 *     тех-жаргона.
 *
 * Триггеры пробы: сетевой отказ axios (onNetworkClassFailure, с дебаунсом),
 * флип onlineManager, автоперепроверка каждые 20 с пока баннер виден и ручная
 * кнопка «Проверить». Любой УСПЕШНЫЙ ответ axios мгновенно прячет баннер —
 * живой трафик убедительнее любой пробы. Пробы ходят через fetch (не axios),
 * чтобы не зациклить сами события.
 *
 * Если офлайн-очередь чеков непуста, к сообщению добавляется
 * «· чеки сохранены и отправятся сами» — мастер знает, что данные не пропали.
 *
 * Слим, не блокирует контент (box-none, интерактивна только кнопка),
 * тёмная тема — сигнальные цвета намеренно одинаковы в обоих режимах,
 * Android-safe (insets + elevation, ничего iOS-only).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { onlineManager } from '@tanstack/react-query';
import { Text } from '../platform/Typography';
import { colors } from '../theme';
import { onNetworkClassFailure, onRequestSucceeded, reselectApiHost } from '../api/axios';
import { isHtmlApiPayload } from '../api/apiHosts';
import { useOfflineCheckQueue } from '../utils/offlineCheckQueue';

type BannerStatus = 'hidden' | 'no-internet' | 'server-unreachable';

/** Нейтральная проба достижимости интернета. 6 с — тот же VPN-запас. */
const NEUTRAL_PROBE_TIMEOUT_MS = 6_000;
/** Мин. пауза между событийными пробами — волна ретраев не должна спамить. */
const PROBE_DEBOUNCE_MS = 8_000;
/** Автоперепроверка, пока баннер виден. */
const RECHECK_INTERVAL_MS = 20_000;

/** Проверка ответа пробы: сам решает, что считать успехом. Может читать тело. */
type ProbeValidate = (res: Response) => Promise<boolean> | boolean;

/**
 * Находка ревью 05.07: HTML-заглушка со статусом 200 (captive-portal, чужой
 * апстрим) «оздоравливала» пробу /health и прятала баннер. Валидируем тело
 * тем же стражем, что и axios.
 */
const notHtmlOk: ProbeValidate = async (res) => {
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
 */
const NEUTRAL_PROBES: ReadonlyArray<{ url: string; validate: ProbeValidate }> = [
  { url: 'https://ya.ru/robots.txt', validate: notHtmlOk },
  {
    url: 'https://captive.apple.com/hotspot-detect.html',
    validate: async (res) => res.ok && (await res.text().catch(() => '')).includes('Success'),
  },
  { url: 'https://www.gstatic.com/generate_204', validate: (res) => res.status === 204 },
];

/** GET с таймаутом; никогда не бросает — только true/false. */
function probeUrl(
  url: string,
  timeoutMs: number,
  validate: ProbeValidate = (res) => res.ok,
  parentSignal?: AbortSignal,
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
        const res = await fetch(url, { method: 'GET', signal: abort.signal });
        finish(await validate(res));
      } catch {
        finish(false);
      }
    })();
  });
}

/** true — первая же проба прошла свой критерий; false — все нет. Не бросает. */
function anyReachable(
  probes: ReadonlyArray<{ url: string; validate: ProbeValidate }>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = probes.length;
    let settled = false;
    for (const probe of probes) {
      void probeUrl(probe.url, timeoutMs, probe.validate, signal).then((ok) => {
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

export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<BannerStatus>(() => (onlineManager.isOnline() ? 'hidden' : 'no-internet'));
  const [checking, setChecking] = useState(false);
  const queuedChecks = useOfflineCheckQueue();

  // Реф-зеркала для стабильных подписок (не пересоздавать слушателей axios
  // на каждый рендер) и для гонок «проба в полёте vs live-успех».
  const statusRef = useRef(status);
  statusRef.current = status;
  const probingRef = useRef(false);
  const lastProbeAt = useRef(0);
  const probeSeq = useRef(0);
  const probeAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  /** Keep the ref in sync immediately, even before React commits a render. */
  const setBannerStatus = useCallback((next: BannerStatus) => {
    statusRef.current = next;
    if (mountedRef.current) setStatus(next);
  }, []);

  /**
   * Invalidate the current result and abort neutral fetches. The host selector
   * has its own generation/queued-pass protection; a subsequent run can call
   * it immediately and will request a fresh pass for the new route.
   */
  const cancelCurrentProbe = useCallback(() => {
    if (!probingRef.current && probeAbortRef.current === null) return;
    probeSeq.current += 1;
    probeAbortRef.current?.abort();
    probeAbortRef.current = null;
    probingRef.current = false;
    if (mountedRef.current) setChecking(false);
  }, []);

  /**
   * Дуальная проба. `manual` обходит дебаунс (кнопка «Проверить» и
   * 20-секундная автоперепроверка должны срабатывать всегда).
   */
  const runProbe = useCallback(async (manual: boolean, restartForNewRoute = false) => {
    const now = Date.now();
    if (probingRef.current && !restartForNewRoute) return;
    if (!manual && now - lastProbeAt.current < PROBE_DEBOUNCE_MS) return;
    // Offline→online (or another explicit route transition) must not be lost
    // behind a stale probe. Invalidate/cancel it and launch the new run now;
    // otherwise reconnect could remain untested until the 20s interval.
    if (probingRef.current) cancelCurrentProbe();
    probingRef.current = true;
    lastProbeAt.current = now;
    const seq = ++probeSeq.current;
    const abort = new AbortController();
    probeAbortRef.current = abort;
    if (manual) setChecking(true);
    try {
      // 1) API доступен? Перевыбираем по ВСЕМУ кольцу, а не
      // проверяем только старую active/static base. Селектор сам владеет
      // таймаутом, точным `{status:"ok"}`, debounce/dedupe и принимает
      // первый здоровый хост для всех следующих axios-запросов.
      const selectedHost = await reselectApiHost(restartForNewRoute).catch(() => null);
      if (!mountedRef.current || abort.signal.aborted || seq !== probeSeq.current) return;
      if (selectedHost) {
        setBannerStatus('hidden');
        return;
      }
      // 2) Сервер нет — а интернет вообще есть?
      const internetOk = await anyReachable(NEUTRAL_PROBES, NEUTRAL_PROBE_TIMEOUT_MS, abort.signal);
      if (!mountedRef.current || abort.signal.aborted || seq !== probeSeq.current) return;
      setBannerStatus(internetOk ? 'server-unreachable' : 'no-internet');
    } finally {
      // An invalidated older run must never clear the state of its replacement.
      if (seq === probeSeq.current) {
        probingRef.current = false;
        if (probeAbortRef.current === abort) probeAbortRef.current = null;
        if (mountedRef.current) setChecking(false);
      }
    }
  }, [cancelCurrentProbe, setBannerStatus]);

  useEffect(() => {
    mountedRef.current = true;

    // NetInfo (через onlineManager — единый источник connectivity-истины с
    // query/mutation pause-логикой): офлайн → мгновенно красный, без проб;
    // онлайн → перепроверка, если баннер был виден (интернет вернулся, но
    // сервер может быть всё ещё отфильтрован).
    const unsubOnline = onlineManager.subscribe((isOnline) => {
      if (!isOnline) {
        cancelCurrentProbe(); // stale route/result must not survive reconnect
        setBannerStatus('no-internet');
      } else if (statusRef.current !== 'hidden') {
        // Force a fresh run even if the old route's selector/fetch is still
        // unwinding; the selector queues a new generation-safe pass.
        void runProbe(true, true);
      }
    });

    // Финальный сетевой отказ axios (нет ответа после failover / 502-504) →
    // дуальная проба (дебаунс внутри runProbe).
    const unsubFailure = onNetworkClassFailure(() => {
      void runProbe(false);
    });

    // Любой успешный ответ axios — сервер доказуемо доступен: прячем баннер
    // мгновенно и обесцениваем пробу в полёте.
    const unsubSuccess = onRequestSucceeded(() => {
      cancelCurrentProbe();
      if (statusRef.current !== 'hidden') setBannerStatus('hidden');
    });

    return () => {
      mountedRef.current = false;
      cancelCurrentProbe();
      unsubOnline();
      unsubFailure();
      unsubSuccess();
    };
  }, [cancelCurrentProbe, runProbe, setBannerStatus]);

  // Автоперепроверка каждые 20 с, пока баннер виден. Живёт только вместе с
  // баннером — скрытый баннер не тратит ни таймера, ни сети.
  useEffect(() => {
    if (status === 'hidden') return;
    const timer = setInterval(() => {
      void runProbe(true);
    }, RECHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status, runProbe]);

  if (status === 'hidden') return null;

  const isNoInternet = status === 'no-internet';
  const message = isNoInternet
    ? 'Нет подключения к интернету'
    : 'Сервер недоступен в вашей сети — попробуйте Wi-Fi или VPN';
  const queueSuffix = queuedChecks.length > 0 ? ' · чеки сохранены и отправятся сами' : '';

  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(180)}
      style={[
        styles.wrap,
        { paddingTop: insets.top, backgroundColor: isNoInternet ? colors.red[600] : colors.orange[600] },
      ]}
      pointerEvents="box-none"
      accessibilityRole="alert"
      accessibilityLabel={message + queueSuffix}
    >
      <View style={styles.row} pointerEvents="box-none">
        <Ionicons
          name={isNoInternet ? 'cloud-offline-outline' : 'server-outline'}
          size={14}
          color={colors.white}
          style={styles.icon}
        />
        <Text style={styles.text} numberOfLines={2}>
          {message}
          {queueSuffix}
        </Text>
        <TouchableOpacity
          style={styles.checkBtn}
          onPress={() => {
            void runProbe(true);
          }}
          disabled={checking}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Проверить соединение"
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          {checking ? (
            <ActivityIndicator size="small" color={colors.white} style={styles.checkSpinner} />
          ) : (
            <Text style={styles.checkBtnText}>Проверить</Text>
          )}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    // backgroundColor — по состоянию (красный / оранжевый), inline.
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  icon: {
    flexShrink: 0,
  },
  text: {
    flexShrink: 1,
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
  checkBtn: {
    flexShrink: 0,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.65)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
    minWidth: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBtnText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  checkSpinner: {
    transform: [{ scale: 0.7 }],
  },
});
