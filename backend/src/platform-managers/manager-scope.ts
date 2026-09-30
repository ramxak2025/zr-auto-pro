import { ForbiddenException } from '@nestjs/common';
import type { JwtPayload } from '../common/decorators/current-user.decorator';
import type { TenantScope } from '../tenants/tenants.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Кто именно ходит в кабинет `/manager/*` и в каком объёме ему видны клиенты.
 *
 * ЭТО ЕДИНСТВЕННОЕ МЕСТО, где роль превращается в область видимости. Кабинет
 * менеджера строится так: контроллер берёт `cabinetActor(user)`, сервис передаёт
 * `actor.scope` в каждый вызов `TenantsService` (там на КАЖДЫЙ запрос к `tenants`
 * навешивается `manager_id = $N`). Поэтому чужой клиент для менеджера
 * неотличим от несуществующего — 404.
 *
 * ПОЧЕМУ ЗДЕСЬ «FAIL-CLOSED», А НЕ ПОЛАГАЕМСЯ НА `@Roles`. `RolesGuard` при
 * ОТСУТСТВИИ метаданных `@Roles` пропускает любого (так устроен весь бэкенд), а
 * суперадмина пропускает всегда. Значит, забытый `@Roles` на новом методе кабинета
 * сделал бы его открытым для директора/мастера. `cabinetActor` — второй, независимый
 * замок: любая роль, кроме `manager` и `superadmin`, получает 403 ещё до первого
 * запроса в БД, а менеджер без валидного uuid в токене — тоже 403, а не «без
 * ограничения».
 */
export interface CabinetActor {
  /** id пользователя из JWT: актор аудита и (для менеджера) владелец портфеля клиентов. */
  userId: string;
  /** true — менеджер платформы (свой портфель, доля владельца); false — суперадмин. */
  isManager: boolean;
  /**
   * Область видимости для `TenantsService`. Менеджер: `{ managerId: <его id> }` —
   * только его клиенты. Суперадмин: `{ managerId: null }` — без ограничения (так же
   * он видит всё в `/tenants`); границу «менеджер видит только своё» это не ослабляет.
   */
  scope: TenantScope;
}

const FORBIDDEN_MESSAGE = 'Недостаточно прав для этого действия';

export function cabinetActor(user: JwtPayload | undefined | null): CabinetActor {
  const userId = user?.userID;
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    throw new ForbiddenException({ message: FORBIDDEN_MESSAGE });
  }
  if (user?.role === 'manager') {
    return { userId, isManager: true, scope: { managerId: userId } };
  }
  if (user?.role === 'superadmin') {
    return { userId, isManager: false, scope: { managerId: null } };
  }
  throw new ForbiddenException({ message: FORBIDDEN_MESSAGE });
}
