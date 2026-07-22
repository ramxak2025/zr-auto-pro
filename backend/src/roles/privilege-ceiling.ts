import { ForbiddenException } from '@nestjs/common';
import { userHasPermission } from '../common/guards/permissions.guard';
import { CANONICAL_PERMISSION_KEYS, flattenRoleMatrix, RawRoleMatrix } from '../common/role-matrix';

/**
 * Актор HTTP-запроса, редактирующий роли: строковая роль + его эффективные
 * права (flatten матрицы назначенной роли, см. jwt.strategy). RolesController
 * прокидывает сюда весь JwtPayload — обоих полей достаточно для потолка.
 */
export type RoleActor = { role?: string; permissions?: Record<string, boolean> };

/**
 * Четыре owner-only ячейки: их может ПОДНИМАТЬ (false→true) только директор/
 * суперадмин (R6, волна «права как в Битрикс24»). Из этих действий admin
 * исключён и в @Roles-гейтах, и в сиде системного «Администратора» (миграция
 * 136). Строже общего потолка: не-директор не выдаёт их ВООБЩЕ — даже если сам
 * получил их кастомной ролью (иначе admin с кастомной ролью и user_management
 * вернул бы себе owner-only-права).
 */
export const OWNER_ONLY_FLAT_KEYS = [
  'salary_payouts_manage',
  'equipment_permanent_delete',
  'company_manage',
  'employees_approve_profile',
] as const;

const OWNER_ONLY_SET = new Set<string>(OWNER_ONLY_FLAT_KEYS);

/**
 * Человекочитаемые подписи всех плоских permission-ключей для текста 403 «какое
 * право нельзя выдать». Зеркало CANONICAL_PERMISSION_KEYS (common/role-matrix);
 * недостающий ключ безопасно падает на сам ключ в assertPrivilegeCeiling.
 */
export const PERMISSION_LABELS: Record<string, string> = {
  checks_view: 'Заказ-наряды: просмотр',
  checks_view_all: 'Заказ-наряды: просмотр всех',
  checks_create: 'Создание заказ-нарядов',
  checks_edit: 'Редактирование заказ-нарядов',
  checks_edit_all: 'Редактирование чужих заказ-нарядов',
  checks_delete: 'Удаление заказ-нарядов',
  checks_change_datetime: 'Изменение даты и времени заказ-наряда',
  edit_closed_check: 'Редактирование закрытого заказ-наряда',
  payment_edit: 'Изменение оплаты',
  accept_payment: 'Приём оплаты (кассовая смена)',
  sell_installment: 'Продажа в рассрочку',
  services_view: 'Услуги: просмотр',
  services_manage: 'Услуги: управление',
  warehouse_access: 'Склад: просмотр',
  warehouse_manage: 'Склад: управление и себестоимость',
  warehouse_delete: 'Склад: удаление товаров',
  suppliers_access: 'Поставщики: просмотр',
  suppliers_manage: 'Поставщики: управление',
  equipment_view: 'Имущество: просмотр',
  equipment_manage: 'Имущество: управление',
  clients_view: 'Клиенты: просмотр',
  clients_edit: 'Клиенты: редактирование',
  schedule_view: 'Расписание: просмотр',
  bookings_access: 'Онлайн-записи: просмотр',
  salary_view: 'Зарплата: просмотр',
  salary_view_all: 'Зарплата: просмотр по всем сотрудникам',
  financial_reports: 'Финансовые отчёты',
  profit_view: 'Просмотр прибыли',
  export_data: 'Экспорт данных',
  cashflow_view: 'Движение денег: просмотр',
  cashflow_view_all: 'Движение денег: просмотр по всем',
  can_add_expenses: 'Добавление расходов',
  marketing_access: 'Маркетинг',
  marketing_manage: 'Маркетинг: управление',
  calls_view: 'Звонки: просмотр',
  calls_listen: 'Звонки: прослушивание',
  user_management: 'Управление сотрудниками',
  cash_shifts_manage: 'Кассовые смены',
  checks_board_manage: 'Доска заказ-нарядов',
  clients_delete: 'Удаление клиентов',
  debts_manage: 'Долги и рассрочка',
  schedule_manage: 'Управление расписанием',
  salary_payouts_manage: 'Выплаты, авансы и штрафы',
  salary_premiums_manage: 'Премии',
  motivation_manage: 'Мотивационные акции',
  warehouse_analytics_view: 'Аналитика склада (маржа и себестоимость)',
  equipment_permanent_delete: 'Безвозвратное удаление имущества',
  employees_approve_profile: 'Согласование изменений профиля',
  settings_manage: 'Настройки',
  company_manage: 'Настройки компании',
  knowledge_manage: 'База знаний',
  knowledge_view: 'База знаний: просмотр',
};

/**
 * ПОТОЛОК ПРИВИЛЕГИЙ (R6 / E-6) — единственная защита редактора ролей от
 * самоэскалации. Держатель user_management, НЕ входящий в owner-class
 * (например кастомная роль «Менеджер смены»: employees.manage=true, но
 * reports.profit=false, cashflow=none, salary.view=none), не должен создать/
 * отредактировать роль, подняв любую ячейку выше собственных эффективных прав
 * и назначить её себе/другим — иначе он получает доступ ко всем финансам.
 *
 * Правило: сравниваем flatten(before) vs flatten(after) и блокируем ТОЛЬКО РОСТ
 * (было не-true → стало true) этой конкретной правкой. Понижение и сохранение
 * как есть (before уже true) — разрешены любому редактору. Scope-ячейки
 * (checks/salary/reports.cashflow) flatten раскладывает в пары булевых ключей
 * (…_view / …_view_all), поэтому расширение охвата none→own→all ловится тем же
 * сравнением плоских ключей.
 *
 * Для поднятой ячейки:
 *   • owner-only (4 ключа) — 403 всегда (их выдаёт только директор);
 *   • иначе — 403, если у самого актора этого права нет (userHasPermission).
 *
 * Директор/суперадмин (owner-class) — БЕЗ потолка: userHasPermission для них
 * возвращает true по любому ключу, поэтому легитимная настройка ролей (в т.ч.
 * copy-on-write системных) не ломается. Нет актора (внутренний вызов без
 * HTTP-контекста) — проверка пропускается (fail-open только для доверенных
 * путей, как и прежняя owner-only-проверка).
 */
export function assertPrivilegeCeiling(before: RawRoleMatrix, after: RawRoleMatrix, actor?: RoleActor): void {
  if (!actor?.role || actor.role === 'director' || actor.role === 'superadmin') return;

  const beforeFlat = flattenRoleMatrix(before);
  const afterFlat = flattenRoleMatrix(after);

  for (const key of CANONICAL_PERMISSION_KEYS) {
    // Интересует только РОСТ привилегии этой правкой: было не-true → стало true.
    if (afterFlat[key] !== true || beforeFlat[key] === true) continue;

    const label = PERMISSION_LABELS[key] ?? key;

    if (OWNER_ONLY_SET.has(key)) {
      throw new ForbiddenException({ message: `Право «${label}» может выдать только директор` });
    }

    if (!userHasPermission(actor, key)) {
      throw new ForbiddenException({
        message: `Нельзя выдать роли право «${label}» — у вас самого его нет`,
      });
    }
  }
}

/**
 * ПОТОЛОК НАЗНАЧЕНИЯ РОЛИ (E-6 доводка) — путь НАЗНАЧЕНИЯ роли пользователю
 * (UsersService.create/update, ветка roleId), которого assertPrivilegeCeiling
 * НЕ покрывает: тот закрывает лишь СОЗДАНИЕ/ПОДЪЁМ роли выше своих прав, но не её
 * РАЗДАЧУ. Без этой проверки не-owner держатель user_management мог назначить
 * себе или другому уже СУЩЕСТВУЮЩУЮ сильную роль (например системного
 * «Администратора» с profit_view / cashflow_view_all), которой у самого актора
 * нет, → эскалация ко всем финансам (в т.ч. через аккаунт с известным паролем) в
 * обход потолка ролей.
 *
 * Правило (для НЕ-owner-class актора): для КАЖДОЙ поднятой (true) ячейки матрицы
 * назначаемой роли —
 *   • owner-only (4 ключа) — 403 всегда (раздаёт только директор);
 *   • иначе — 403, если этого права нет у самого актора (userHasPermission).
 * Роль со СВОИМИ правами или НИЖЕ — назначается свободно. Owner-class
 * (director/superadmin) и отсутствие актора (внутренний вызов без HTTP-контекста)
 * — БЕЗ потолка (симметрично assertPrivilegeCeiling). Scope-ячейки (checks/salary/
 * reports.cashflow) сравниваются теми же плоскими ключами (…_view / …_view_all),
 * поэтому расширение охвата none→own→all ловится тем же перебором.
 */
export function assertRoleAssignable(roleMatrix: unknown, actor?: RoleActor): void {
  if (!actor?.role || actor.role === 'director' || actor.role === 'superadmin') return;

  const flat = flattenRoleMatrix(roleMatrix);

  for (const key of CANONICAL_PERMISSION_KEYS) {
    if (flat[key] !== true) continue;

    const label = PERMISSION_LABELS[key] ?? key;

    if (OWNER_ONLY_SET.has(key)) {
      throw new ForbiddenException({
        message: `Нельзя назначить роль с правом «${label}» — его выдаёт только директор`,
      });
    }

    if (!userHasPermission(actor, key)) {
      throw new ForbiddenException({
        message: `Нельзя назначить роль с правами выше ваших: «${label}»`,
      });
    }
  }
}
