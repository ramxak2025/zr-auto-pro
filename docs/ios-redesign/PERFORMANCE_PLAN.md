# Performance Plan — Autexa iOS

## Текущая боль

1. **Холодный старт = пустой UI**. После Force Quit и повторного открытия приложение всегда показывает empty state / spinner на 1-3 секунды, потом «прыжок» к данным. Это делает iOS-version неприятной по сравнению с веб-версией где данные кешируются в memory + IndexedDB.

2. **Ложный «0 товаров»**. На `ProductsScreen` бейдж в header показывает `0 товаров` пока `useQuery({ queryKey: ['products', ...] })` не закроется.

3. **Медленные переходы между табами**. Каждый таб делает свои запросы при первом монтировании. Если они зависят от данных (например, ChecksScreen требует список masters) — увидите сначала spinner, потом контент.

4. **Каждый раз новый запрос на ту же страницу**. staleTime = 30s — слишком мало для прайс-листов и каталогов. После 30 секунд при возврате на экран — спиннер.

5. **GridTab в ScheduleScreen** делает 2 запроса (schedule + users) на каждый месяц. Если пользователь листает Pn-Mar-Jul — каждый раз новые запросы.

## План

### 1. Persistent Cache через AsyncStorage

Создаём `mobile/src/utils/persistentCache.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QueryClient } from '@tanstack/react-query';

const PREFIX = 'rqcache:v1:';
const PERSISTED_KEYS: string[] = [
  'products',           // склад
  'all-services',       // услуги
  'all-products-check', // каталог для чека
  'users',              // мастера
  'schedule',           // расписание (последний месяц)
];

export async function hydrateCache(qc: QueryClient): Promise<void> {
  for (const key of PERSISTED_KEYS) {
    const raw = await AsyncStorage.getItem(PREFIX + key).catch(() => null);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.data && parsed?.queryKey) {
        qc.setQueryData(parsed.queryKey, parsed.data);
      }
    } catch {}
  }
}

export function attachPersistence(qc: QueryClient): () => void {
  const unsubscribe = qc.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated') return;
    const query = event.query;
    const firstKey = Array.isArray(query.queryKey) ? query.queryKey[0] : null;
    if (typeof firstKey !== 'string' || !PERSISTED_KEYS.includes(firstKey)) return;
    if (query.state.status !== 'success') return;
    AsyncStorage.setItem(
      PREFIX + firstKey,
      JSON.stringify({ queryKey: query.queryKey, data: query.state.data })
    ).catch(() => {});
  });
  return unsubscribe;
}
```

В `App.tsx`:

```ts
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000, gcTime: 30 * 60_000, retry: 2 } }
});

useEffect(() => {
  hydrateCache(queryClient).then(() => attachPersistence(queryClient));
}, []);
```

### 2. Показывать кеш сразу + revalidate в фоне

TanStack Query делает это **из коробки**: если в `queryClient` уже есть данные по ключу — он возвращает их и одновременно делает refetch (если `staleTime` истёк). 

С persistentCache:
- На холодный старт `hydrateCache()` залил данные в QueryClient ДО того как любой компонент смонтировался
- Компонент монтируется → `useQuery(...)` сразу видит данные → показывает их
- Параллельно идёт refetch → когда придёт свежий ответ → UI обновится

Эффект: **никакого пустого экрана при старте**, если до этого приложение хоть раз успешно открывало эти данные.

### 3. Prefetch ключевых запросов после логина

В `AuthContext.login()` после `setUser(u)`:

```ts
// Кеш будет готов когда пользователь дойдёт до экрана
queryClient.prefetchQuery({
  queryKey: ['products', { search: '', limit: 500 }],
  queryFn: async () => (await productsApi.getAll({ search: '', limit: 500 })).data,
  staleTime: 5 * 60_000,
});
queryClient.prefetchQuery({
  queryKey: ['all-services'],
  queryFn: async () => (await servicesApi.getAll({ limit: 500 })).data?.data || [],
  staleTime: 10 * 60_000,
});
queryClient.prefetchQuery({
  queryKey: ['users'],
  queryFn: async () => (await usersApi.getAll()).data,
  staleTime: 5 * 60_000,
});
```

Запросы идут параллельно после логина пока пользователь видит spinner перехода на Dashboard. Когда он откроет Склад — данные уже там.

### 4. Убрать ложный «0 товаров»

В `ProductsScreen.tsx`:

```diff
- <Text style={styles.countBadgeText}>{warehouseStats.count} товаров</Text>
+ <Text style={styles.countBadgeText}>
+   {data === undefined ? '...' : `${warehouseStats.count} товаров`}
+ </Text>
```

И в самом списке — уже есть `isLoading ? <ListSkeleton /> : ...` ✅. Дополнительно: skeleton также при `isFetching` если `data === undefined` (не путать с background refetch).

### 5. Оптимизация ScheduleScreen GridTab

- `entryMap` уже мемоизирован
- `GridDayRow` уже `memo()`
- Добавить `windowSize={5}` если используется FlatList (сейчас ScrollView — оставляем)
- staleTime поднять с 30s до 2 минут

### 6. FlashList для ChecksScreen

Сейчас обычный FlatList. На длинных списках чеков (>200 записей) рендерится медленнее. Перевод на FlashList:

```diff
- <FlatList ... />
+ <FlashList ... estimatedItemSize={120} />
```

Изменение мелкое — только меняется компонент, props почти те же.

### 7. Memoization

- `formatMoney` — pure функция, можно `useMemo` если вызывается в render-loop
- `getCellDot` (Schedule) — мемоизировать через `useCallback`/`useMemo` зависимый от entry

### 8. Image optimization

- `expo-image` уже используется (через `CachedImage` обёртку)
- Добавить `recyclingKey` для длинных списков (FlashList перерасiclает items)

## Метрики цели

| Метрика | До | Цель |
|---------|-----|------|
| Холодный старт → Dashboard визуально готов | 2-4s spinner | <500ms (из кеша) |
| Tap «Склад» → видно товары | 0.5-1.5s spinner | <100ms (мгновенно из кеша) |
| Tap «Касса» → форма готова | 1-2s | <300ms |
| Возврат на экран после 30s | spinner | мгновенно (из кеша, refetch в фоне) |

## Не трогаем

- Запросы при первом логине (если backend недоступен — спиннер ок)
- Loading states при создании/редактировании (нужны явные loading)
- Pagination (warehouse limit=500 — пока ок)
