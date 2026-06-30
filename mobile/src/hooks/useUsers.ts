/**
 * useUsers — единый источник правды для списка сотрудников.
 *
 * КОРЕНЬ ПЕРЕМЕЖАЮЩЕГОСЯ БАГА «Нет сотрудников» / «Нет мастеров»:
 * В ОДИН ключ кэша ['users'] писали сразу несколько мест — login-prefetch
 * (`AuthContext.prefetchAfterLogin`), три вкладки ScheduleScreen
 * (грид / рейтинг / настройки), DashboardScreen и UsersScreen. Все,
 * КРОМЕ UsersScreen, клали в кэш чистый `User[]`. UsersScreen же клал сырой
 * `AxiosResponse` и доставал массив локальным `select: (res) => res.data`.
 *
 * `queryFn` НЕ входит в ключ кэша → общий слот ['users'] принимает ту форму,
 * которую записал ПОСЛЕДНИЙ писатель. Отсюда расхождение по навигации:
 *   • записали Schedule/prefetch (массив) → у UsersScreen `select(массив).data
 *     === undefined` → users = [] → «Нет сотрудников», хотя сотрудники есть;
 *   • записал UsersScreen (AxiosResponse) → у Schedule `toArray(resp) === []`
 *     → «Нет мастеров», хотя мастера есть. При этом «Сегодня» берёт данные из
 *     другого ключа ['schedule-today'] и работает — ровно как в баг-репорте.
 * persistentCache усиливал баг между холодными стартами (мог сохранить/поднять
 * сырой axios-ответ под ключом 'users').
 *
 * Лечение фундаментальное: ОДНА `queryFn`, которая ВСЕГДА возвращает `User[]`.
 * Теперь слот ['users'] имеет единственную форму у всех читателей, а
 * persistentCache зеркалит сериализуемый массив. Экраны на ['users']
 * (UsersScreen + ScheduleScreen) ходят через `useUsers`, EmployeesScreen — на
 * отдельный ключ ['users-all'] через `useAllStaff` (см. ниже).
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { usersApi } from '../api/services';
import type { User } from '../../../shared/types';

/** Канонический ключ списка сотрудников (ScheduleScreen + UsersScreen). */
export const USERS_QUERY_KEY = ['users'] as const;

/**
 * Отдельный ключ EmployeesScreen. Намеренно НЕ ['users'], чтобы инвалидации
 * одного раздела не дёргали запросы другого (cross-talk) — но форма та же
 * (`User[]`) и resilience та же, поэтому источник один (`fetchUsers`).
 */
export const USERS_ALL_QUERY_KEY = ['users-all'] as const;

/**
 * Привести любое значение из кэша к `User[]`. Защищает от отравленного или
 * протухшего значения (сырой `AxiosResponse`, не-массив из окна 502): кривая
 * форма деградирует в `[]`, а не роняет `.filter` / `.map` ниже по коду и не
 * выдаёт ложное «пусто».
 */
export function toUserArray(value: unknown): User[] {
  return Array.isArray(value) ? (value as User[]) : [];
}

/** Единственная queryFn для обоих ключей — всегда отдаёт `User[]`. */
async function fetchUsers(): Promise<User[]> {
  const res = await usersApi.getAll();
  return toUserArray(res.data);
}

/**
 * ['users'] — список сотрудников для ScheduleScreen (грид / рейтинг /
 * настройки) и UsersScreen. Всегда массив; SWR через `placeholderData`
 * (не мигает пустотой при фоновом рефетче); cold-start из persistentCache
 * (ключ 'users' уже в whitelist). `staleTime` 5 мин — справочные данные,
 * штат меняется редко (совпадает с GridTab и login-prefetch).
 */
export function useUsers(): UseQueryResult<User[]> {
  return useQuery<User[]>({
    queryKey: USERS_QUERY_KEY,
    queryFn: fetchUsers,
    placeholderData: (prev) => prev,
    staleTime: 5 * 60_000,
  });
}

/**
 * ['users-all'] — список штата для EmployeesScreen. Отдельный ключ (см.
 * комментарий к {@link USERS_ALL_QUERY_KEY}), та же форма и resilience:
 * массив + SWR + cold-start из кэша (ключ 'users-all' в whitelist).
 * `staleTime` 1 мин — экран сотрудников хочет свежее (рядом со статусом смен).
 */
export function useAllStaff(): UseQueryResult<User[]> {
  return useQuery<User[]>({
    queryKey: USERS_ALL_QUERY_KEY,
    queryFn: fetchUsers,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  });
}

// ── Чистая дискриминация состояния (loading / error / empty / list) ──────────
// Без react / react-native импортов в самой логике → юнит-тестируется под
// node-jest (как scheduleViewState.ts). Экраны UsersScreen и EmployeesScreen
// рендерят «пусто» ТОЛЬКО при подтверждённом успехе и реально пустом списке.

export type StaffListView = 'skeleton' | 'error' | 'empty' | 'list';

export interface StaffListViewInput {
  /** `data` из useQuery определена (настоящий ответ ИЛИ placeholder-массив). */
  hasData: boolean;
  /** Запрос завершился ошибкой. */
  isError: boolean;
  /** Запрос ПОДТВЕРЖДЁННО успешен (React Query `status === 'success'`). */
  isSuccess: boolean;
  /** Сколько строк реально показать (после клиентской фильтрации). */
  visibleCount: number;
}

/**
 * Что рисует экран сотрудников / пользователей. Порядок веток важен.
 *
 *   • есть что показать (`visibleCount > 0`) → 'list' — данные всегда
 *     побеждают, мы НИКОГДА не мигаем skeleton/empty поверх реальных строк;
 *   • данных ещё нет (`hasData === false`): ошибка → 'error', иначе → 'skeleton';
 *   • данные есть, но показывать нечего (0 строк после фильтра):
 *       – подтверждённый успех → 'empty' (ЕДИНСТВЕННОЕ легальное «пусто»);
 *       – ошибка → 'error' (был кэш, последний фетч упал, показывать нечего);
 *       – иначе (placeholder / stale без подтверждения) → 'skeleton',
 *         НИКОГДА не «пусто» — это и есть фикс перемежающегося бага.
 */
export function decideStaffListView({ hasData, isError, isSuccess, visibleCount }: StaffListViewInput): StaffListView {
  if (visibleCount > 0) return 'list';
  if (!hasData) return isError ? 'error' : 'skeleton';
  if (isSuccess) return 'empty';
  if (isError) return 'error';
  return 'skeleton';
}
