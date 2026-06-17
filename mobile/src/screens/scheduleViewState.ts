/**
 * scheduleViewState — чистая логика выбора того, ЧТО рисует GridTab
 * (skeleton / error / «Нет мастеров» / грид).
 *
 * КОРЕНЬ БАГА «Нет мастеров, хотя мастера есть»:
 * Старое условие в ScheduleScreen решало показ empty-state по
 * `usersData === undefined`. Но React Query при гидратации из
 * persistentCache (и при деградации backend в окне 502) кладёт в кэш
 * ПУСТОЙ МАССИВ `[]`, а не `undefined`. Тогда:
 *   • `activeUsers.length === 0` — потому что массив пуст;
 *   • `usersData === undefined` — ЛОЖЬ (это `[]`, а не undefined);
 * → ветка skeleton/error не срабатывала, и пустой (ещё не подтверждённый
 * сервером) список проваливался прямо в «Нет мастеров».
 *
 * ПРАВИЛЬНЫЙ КРИТЕРИЙ: «Нет мастеров» показываем ТОЛЬКО когда запрос
 * `['users']` реально в подтверждённо-успешном состоянии и при этом
 * мастеров после фильтрации нет. Пустой массив из протухшего кэша,
 * по которому ещё идёт фоновый рефетч (stale-while-revalidate), —
 * это НЕ «успешно и пусто», это «ещё не знаем» → skeleton/предыдущее.
 *
 * Функция намеренно не зависит от React/RN — её можно покрыть юнит-тестами
 * по всем веткам (см. scheduleViewState.test.ts).
 */

export type ScheduleView = 'skeleton' | 'error' | 'empty' | 'grid';

export interface ScheduleViewInput {
  /** Навигационная push-анимация ещё не отыграла — грид не смонтирован. */
  gridReady: boolean;
  /** ['users']: первая загрузка без подтверждённых данных. */
  isLoadingUsers: boolean;
  /** ['users']: запрос завершился ошибкой. */
  isErrorUsers: boolean;
  /**
   * ['users']: запрос ПОДТВЕРЖДЁННО успешен (сервер ответил, данные — это
   * настоящий ответ, а не placeholder из протухшего кэша). В React Query
   * это `status === 'success'`.
   */
  isSuccessUsers: boolean;
  /** Кол-во мастеров после фильтрации owners/неактивных. */
  activeUsersCount: number;
  /**
   * В кэше уже есть какие-то пользователи (массив непустой) — даже если это
   * placeholder/stale. Когда true, мы всегда можем показать грид и не мигать
   * на skeleton при фоновом рефетче.
   */
  hasCachedUsers: boolean;
  /** Запрос расписания ['schedule', …] завершился ошибкой. */
  scheduleError: boolean;
}

/**
 * Решение, что рендерить. Порядок веток важен.
 *
 * Логика:
 *   0. Грид ещё не смонтирован (push-анимация) → skeleton.
 *   1. Есть мастера (после фильтра) → grid. Это всегда выигрывает: данные
 *      есть — показываем их, неважно какой fetchStatus.
 *   2. Есть закэшированные пользователи (placeholder/stale), но после
 *      фильтра 0 (например все скрыты/owners) — доверяем кэшу как
 *      результату → решаем по успеху ниже; пока запрос не подтверждён и
 *      это не ошибка — skeleton, чтобы не мигать пустотой.
 *   3. Запрос подтверждённо успешен и мастеров нет → «Нет мастеров».
 *   4. Ошибка без подтверждённых данных → error-state.
 *   5. Иначе (первая загрузка ИЛИ stale-рефетч пустого кэша без
 *      подтверждения) → skeleton. НИКОГДА не «Нет мастеров» здесь.
 */
export function decideScheduleView(input: ScheduleViewInput): ScheduleView {
  const { gridReady, isLoadingUsers, isErrorUsers, isSuccessUsers, activeUsersCount, hasCachedUsers, scheduleError } =
    input;

  // 0. Push-анимация ещё идёт — грид не монтируем.
  if (!gridReady) return 'skeleton';

  // 1. Есть мастера — показываем грид независимо от статуса запроса.
  if (activeUsersCount > 0) return 'grid';

  // С этого места activeUsersCount === 0.

  // 2. Запрос подтверждённо успешен и пусто → честный empty-state.
  //    Это ЕДИНСТВЕННОЕ место, где разрешено «Нет мастеров».
  if (isSuccessUsers) return 'empty';

  // 3. Ошибка и нет подтверждённых данных → error-state.
  //    (И ошибка пользователей, и падение расписания — оба ведут сюда,
  //    т.к. без мастеров грид всё равно не построить.)
  if ((isErrorUsers || scheduleError) && !hasCachedUsers) return 'error';

  // 4. Всё остальное — первая загрузка или stale-рефетч пустого кэша,
  //    результат ещё не подтверждён → skeleton, НЕ «Нет мастеров».
  //    `isLoadingUsers` и `hasCachedUsers` здесь информативны, но в любом
  //    из этих под-случаев правильный ответ — skeleton.
  void isLoadingUsers;
  void hasCachedUsers;
  return 'skeleton';
}
