/**
 * OfflineBanner — умный сетевой баннер (Round 9), вместо прежней «просто
 * красной полосы „Нет соединения"».
 *
 * ЗАЧЕМ: в сети автосервиса владельца оператор фильтрует домен API — интернет
 * на телефоне ЕСТЬ (NetInfo молчит), но сервер недостижим. Старый баннер в
 * этом случае не показывался вовсе, и отказы выглядели как «приложение
 * сломалось». Новый различает три ситуации ступенчатой пробой:
 *
 *   1. Общий host-selector гоняет /health по ВСЕМ хостам
 *      failover-кольца и принимает первый здоровый — API доступен?
 *   2. Нейтральная достижимость по ИМЕНАМ (ya.ru / captive.apple.com /
 *      gstatic generate_204, 6 с) — интернет вообще есть?
 *   3. Если по именам не прошло ничего — достижимость по IP-литералу
 *      (DoH 1.1.1.1 / 8.8.8.8, сертификат валиден на сам адрес, DNS не
 *      нужен) — сеть жива, но имена не разрешаются?
 *
 * Исходы:
 *   • API ok → баннер скрыт (это был кратковременный сбой);
 *   • не прошло вообще ничего → «Нет подключения к интернету» (красный);
 *   • имена мертвы, а по IP дошли → «Не разрешаются адреса — мешает VPN или
 *     DNS» (оранжевый). Раньше этот случай врал красным «нет интернета», и
 *     владелец искал поломку в приложении или на сервере — см.
 *     utils/networkDiagnosis.ts, механизм пойман 26.07.2026;
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
import { useOfflineCheckQueue } from '../utils/offlineCheckQueue';
import { diagnoseConnectivity } from '../utils/networkDiagnosis';

type BannerStatus = 'hidden' | 'no-internet' | 'dns-blocked' | 'server-unreachable';

/** Нейтральная проба достижимости интернета. 6 с — тот же VPN-запас. */
const NEUTRAL_PROBE_TIMEOUT_MS = 6_000;
/** Мин. пауза между событийными пробами — волна ретраев не должна спамить. */
const PROBE_DEBOUNCE_MS = 8_000;
/** Автоперепроверка, пока баннер виден. */
const RECHECK_INTERVAL_MS = 20_000;

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
  const runProbe = useCallback(
    async (manual: boolean, restartForNewRoute = false) => {
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
        // 2-3) Сервер нет — а интернет вообще есть, и если нет, то по-настоящему
        // или только по именам? Вторую ступень платим лишь при провале первой.
        const verdict = await diagnoseConnectivity(NEUTRAL_PROBE_TIMEOUT_MS, abort.signal);
        if (!mountedRef.current || abort.signal.aborted || seq !== probeSeq.current) return;
        setBannerStatus(
          verdict === 'internet-ok' ? 'server-unreachable' : verdict === 'dns-blocked' ? 'dns-blocked' : 'no-internet',
        );
      } finally {
        // An invalidated older run must never clear the state of its replacement.
        if (seq === probeSeq.current) {
          probingRef.current = false;
          if (probeAbortRef.current === abort) probeAbortRef.current = null;
          if (mountedRef.current) setChecking(false);
        }
      }
    },
    [cancelCurrentProbe, setBannerStatus],
  );

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
  const isDnsBlocked = status === 'dns-blocked';
  // «Не разрешаются адреса» — сознательно без слова DNS в первой половине
  // фразы: владельцу нужно действие (выключить VPN), а не термин.
  const message = isNoInternet
    ? 'Нет подключения к интернету'
    : isDnsBlocked
      ? 'Не разрешаются адреса — мешает VPN или DNS. Выключите VPN'
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
          name={isNoInternet ? 'cloud-offline-outline' : isDnsBlocked ? 'globe-outline' : 'server-outline'}
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
