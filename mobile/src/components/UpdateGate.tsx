/**
 * UpdateGate — мягкий kill-switch «минимальная версия клиента».
 *
 * Сценарий: в сборке N найден критичный баг, который нельзя починить по OTA
 * (native-слой). Владелец выставляет на сервере MIN_IOS_BUILD=N+1 — и все
 * сборки старше видят полноэкранный блокирующий экран «Нужно обновление» с
 * кнопкой в TestFlight/стор, вместо того чтобы молча портить учёт.
 *
 * Поведение:
 *   • проверка на старте (mount) + при возврате в foreground, но не чаще
 *     раза в час (CLIENT_VERSION_RECHECK_MS);
 *   • эндпоинт публичный (`GET /api/client-version`, без JWT) — гейт работает
 *     и на экране логина;
 *   • обычный fetch с таймаутом 5с, НЕ общий axios-инстанс — гейт не зависит
 *     от интерсепторов и failover-кольца и не может их дёргать;
 *   • ЛЮБАЯ ошибка сети/сервера = молча пропустить: офлайн-мастер у кассы
 *     важнее kill-switch (fail-open, см. utils/clientVersionGate.ts);
 *   • серверный дефолт min=0 → экран не появляется никогда — код инертен,
 *     пока env на сервере не выставлен;
 *   • если сервер ПОНИЗИЛ минимум (откат ошибочной блокировки) — следующая
 *     проверка снимает блокировку без перезапуска приложения.
 *
 * Монтируется в App.tsx ПОВЕРХ всего дерева (последний ребёнок
 * SafeAreaProvider, zIndex выше SplashOverlay) — блокировка перекрывает и
 * сплеш, и навигацию, и все модалки. Пока не заблокировано — рендерит null
 * (нулевая стоимость в обычной жизни).
 *
 * Визуал сознательно статичный светлый (как SplashOverlay): терминальное
 * состояние, темизация не нужна.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type AppStateStatus,
  type NativeEventSubscription,
} from 'react-native';
import * as Application from 'expo-application';
import { getActiveApiBaseUrl } from '../api/axios';
import { colors, spacing } from '../theme';
import { Text } from '../platform/Typography';
import {
  CLIENT_VERSION_RECHECK_MS,
  fetchClientVersion,
  minBuildForPlatform,
  shouldBlockClient,
  updateUrlForPlatform,
} from '../utils/clientVersionGate';

const DEFAULT_MESSAGE =
  'Эта версия приложения устарела и больше не поддерживается. Обновите приложение, чтобы продолжить работу.';

interface BlockedState {
  message: string;
  url: string;
}

export default function UpdateGate() {
  const [blocked, setBlocked] = useState<BlockedState | null>(null);
  const lastCheckedAtRef = useRef(0);
  const inFlightRef = useRef(false);

  const evaluate = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // Failover-aware база: если primary-домен зафильтрован оператором,
      // кольцо в axios.ts уже переключило активный хост — читаем его.
      const info = await fetchClientVersion(getActiveApiBaseUrl());
      // null = офлайн / таймаут / 5xx / кривой JSON → fail-open: сохраняем
      // ПРЕДЫДУЩЕЕ состояние (не блокируем новых, не разблокируем уже
      // заблокированных по слову сервера).
      if (!info) return;
      const min = minBuildForPlatform(info, Platform.OS);
      if (shouldBlockClient(Application.nativeBuildVersion, min)) {
        setBlocked({
          message: info.message ?? DEFAULT_MESSAGE,
          url: updateUrlForPlatform(info, Platform.OS),
        });
      } else {
        // Сервер разрешает эту сборку (или откатил минимум) — снимаем блок.
        setBlocked(null);
      }
    } catch {
      // Никогда не даём гейту уронить приложение.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    // Проверка на старте…
    lastCheckedAtRef.current = Date.now();
    void evaluate();

    // …и на каждом чистом возврате в foreground, но не чаще раза в час.
    let prevState: AppStateStatus = AppState.currentState;
    const onChange = (next: AppStateStatus) => {
      const isComingToForeground = next === 'active' && prevState !== 'active';
      prevState = next;
      if (!isComingToForeground) return;
      const now = Date.now();
      if (now - lastCheckedAtRef.current < CLIENT_VERSION_RECHECK_MS) return;
      lastCheckedAtRef.current = now;
      void evaluate();
    };
    const sub: NativeEventSubscription = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [evaluate]);

  if (!blocked) return null;

  const version = Application.nativeApplicationVersion;
  const build = Application.nativeBuildVersion;

  return (
    <View style={styles.root} accessibilityViewIsModal>
      <View style={styles.center}>
        <Image source={require('../../assets/logo.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.title} accessibilityRole="header">
          Нужно обновление
        </Text>
        <Text style={styles.message}>{blocked.message}</Text>
        {blocked.url ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Обновить приложение"
            onPress={() => {
              Linking.openURL(blocked.url).catch(() => {});
            }}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonLabel}>Обновить</Text>
          </Pressable>
        ) : null}
        {version || build ? (
          <Text style={styles.versionFooter}>
            Текущая версия {version ?? '—'}
            {build ? ` (сборка ${build})` : ''}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    // Выше SplashOverlay (9999): блокировка — самое верхнее состояние UI.
    zIndex: 10000,
    elevation: 10000,
  },
  center: {
    alignItems: 'center',
    paddingHorizontal: spacing[6],
    maxWidth: 420,
  },
  logo: {
    // Пропорции logo.png (752×196) — как в SplashOverlay, чтобы блок-экран
    // ощущался «родным» продолжением сплеша, а не чужой страницей.
    width: 220,
    height: 57,
    marginBottom: spacing[6],
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.gray[900],
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: spacing[3],
  },
  message: {
    fontSize: 15,
    lineHeight: 21,
    color: colors.gray[500],
    textAlign: 'center',
    marginBottom: spacing[6],
  },
  button: {
    backgroundColor: colors.primary[600],
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: spacing[8],
    minWidth: 200,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  versionFooter: {
    marginTop: spacing[6],
    fontSize: 12,
    color: colors.gray[400],
  },
});
