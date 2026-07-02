/**
 * OfflineBanner — умный сетевой баннер (Round 9), вместо прежней «просто
 * красной полосы „Нет соединения"».
 *
 * ЗАЧЕМ: в сети автосервиса владельца оператор фильтрует домен API — интернет
 * на телефоне ЕСТЬ (NetInfo молчит), но сервер недостижим. Старый баннер в
 * этом случае не показывался вовсе, и отказы выглядели как «приложение
 * сломалось». Новый различает две ситуации дуальной пробой:
 *
 *   1. GET {активная база}/health (короткий таймаут) — сервер доступен?
 *   2. Нейтральная достижимость (captive.apple.com / gstatic generate_204,
 *      3 с) — интернет вообще есть?
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
import { getActiveApiBaseUrl, onNetworkClassFailure, onRequestSucceeded } from '../api/axios';
import { useOfflineCheckQueue } from '../utils/offlineCheckQueue';

type BannerStatus = 'hidden' | 'no-internet' | 'server-unreachable';

/** Health-проба API — «дохлый» сервер может не слать RST, поэтому таймаут. */
const API_PROBE_TIMEOUT_MS = 4_000;
/** Нейтральная проба достижимости интернета. */
const NEUTRAL_PROBE_TIMEOUT_MS = 3_000;
/** Мин. пауза между событийными пробами — волна ретраев не должна спамить. */
const PROBE_DEBOUNCE_MS = 8_000;
/** Автоперепроверка, пока баннер виден. */
const RECHECK_INTERVAL_MS = 20_000;

/**
 * Нейтральные endpoint'ы «интернет вообще есть?». Первым — Apple captive
 * probe (его дёргает каждый iPhone планеты — в РФ гарантированно не
 * фильтруется), gstatic — резерв. Достаточно ЛЮБОГО успеха.
 */
const NEUTRAL_PROBE_URLS = ['https://captive.apple.com/hotspot-detect.html', 'https://www.gstatic.com/generate_204'];

/** GET с таймаутом; никогда не бросает — только true/false. */
async function probeUrl(url: string, timeoutMs: number): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', signal: abort.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** true — первый же URL ответил 2xx; false — все недоступны. Не бросает. */
function anyReachable(urls: readonly string[], timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let remaining = urls.length;
    let settled = false;
    for (const url of urls) {
      void probeUrl(url, timeoutMs).then((ok) => {
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
  const mountedRef = useRef(true);

  /**
   * Дуальная проба. `manual` обходит дебаунс (кнопка «Проверить» и
   * 20-секундная автоперепроверка должны срабатывать всегда).
   */
  const runProbe = useCallback(async (manual: boolean) => {
    const now = Date.now();
    if (probingRef.current) return;
    if (!manual && now - lastProbeAt.current < PROBE_DEBOUNCE_MS) return;
    probingRef.current = true;
    lastProbeAt.current = now;
    const seq = ++probeSeq.current;
    if (manual) setChecking(true);
    try {
      // 1) Сервер доступен? Пробуем АКТИВНУЮ базу (с учётом failover-резерва).
      const apiOk = await probeUrl(`${getActiveApiBaseUrl()}/health`, API_PROBE_TIMEOUT_MS);
      if (!mountedRef.current || seq !== probeSeq.current) return;
      if (apiOk) {
        setStatus('hidden');
        return;
      }
      // 2) Сервер нет — а интернет вообще есть?
      const internetOk = await anyReachable(NEUTRAL_PROBE_URLS, NEUTRAL_PROBE_TIMEOUT_MS);
      if (!mountedRef.current || seq !== probeSeq.current) return;
      setStatus(internetOk ? 'server-unreachable' : 'no-internet');
    } finally {
      probingRef.current = false;
      if (mountedRef.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // NetInfo (через onlineManager — единый источник connectivity-истины с
    // query/mutation pause-логикой): офлайн → мгновенно красный, без проб;
    // онлайн → перепроверка, если баннер был виден (интернет вернулся, но
    // сервер может быть всё ещё отфильтрован).
    const unsubOnline = onlineManager.subscribe((isOnline) => {
      if (!isOnline) {
        probeSeq.current += 1; // гонка: проба в полёте не должна перезаписать
        setStatus('no-internet');
      } else if (statusRef.current !== 'hidden') {
        void runProbe(true);
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
      if (statusRef.current !== 'hidden') {
        probeSeq.current += 1;
        setStatus('hidden');
      }
    });

    return () => {
      mountedRef.current = false;
      unsubOnline();
      unsubFailure();
      unsubSuccess();
    };
  }, [runProbe]);

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
