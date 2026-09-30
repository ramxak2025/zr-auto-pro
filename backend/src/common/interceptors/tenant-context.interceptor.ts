import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { NO_TENANT_ID } from '../auth-cache';
import { runWithTenant } from '../tenant-context';

/**
 * TenantContextInterceptor (волна B, RLS) — кладёт tenantID аутентифицированного
 * запроса в AsyncLocalStorage, чтобы TenantAwarePool маршрутизировал все DB-вызовы
 * этого запроса через app-пул под Row Level Security.
 *
 * Почему интерцептор, а не middleware/guard:
 *   • middleware выполняется ДО guard'ов — request.user ещё нет;
 *   • JwtAuthGuard/RolesGuard/PermissionsGuard выполняются до интерцепторов ⇒
 *     их собственные запросы (revoked_tokens, users по id) идут при пустом CLS
 *     через admin-пул — это корректно: на этапе валидации токена тенант ещё
 *     не доказан;
 *   • интерцептор — первая точка, где user уже проверен и доступен.
 *
 * Почему подписка обёрнута в runWithTenant через new Observable: next.handle()
 * лишь СОЗДАЁТ observable, а хендлер маршрута вызывается в момент подписки.
 * Подписываемся внутри ALS-контекста — вся async-цепочка хендлера (и каждый
 * this.pool.query в сервисах) наследует контекст тенанта.
 *
 * Кто НЕ получает контекст (остаётся на admin-пуле, поведение как сегодня):
 *   • неаутентифицированные пути — login/register, health, публичная страница
 *     отзыва, вебхуки телефонии/эквайринга, GET /uploads/*;
 *   • superadmin — его admin-эндпоинты легитимно ходят ПО ВСЕМ тенантам
 *     (тарифы, список тенантов, глобальные рассылки), RLS их сломала бы;
 *   • manager (сотрудник платформы, миграция 173) — admin-пул ТОЛЬКО на
 *     маршрутах кабинета `/api/manager/*`, на `/api/auth/*` и на `/api/profile/*`
 *     (кабинет читает subscription_payments под FORCE RLS по чужим тенантам, а
 *     `me`/`logout`/«мой профиль» ключуются по userID актора: политика UPDATE на
 *     `users` пускает только строки СВОЕГО тенанта, и под nil-tenant правка
 *     собственной строки менеджера молча затронула бы 0 строк — смена пароля
 *     «прошла» бы, ничего не изменив). Разбор всех обработчиков `/profile/*`:
 *     менять они могут только строку `req.user.userID`, а ветки с чужими данными
 *     (очередь запросов, одобрение) закрыты ключом `employees_approve_profile`,
 *     которого у менеджера нет (PermissionsGuard срабатывает раньше интерцептора).
 *     На ВСЕХ остальных маршрутах менеджер идёт
 *     в app-пул с nil-tenant: RLS ничего не отдаёт, и случайно незащищённое
 *     чтение тенантных таблиц (`GET /users`, `GET /plans`, …) остаётся пустым, а
 *     не превращается в утечку по всем автосервисам. Это ВТОРОЙ рубеж — первый
 *     `@Roles`/JwtAuthGuard; без DB_APP_PASSWORD (одиночный пул) полагаемся на него;
 *   • пользователи без tenant_id (tenantID='' после COALESCE в jwt.strategy);
 *   • кроны и фоновые джобы — они вообще не проходят через HTTP-интерцепторы.
 *
 * UUID-проверка — защита инварианта: GUC app.tenant_id кастуется в политиках
 * к uuid; мусор в значении дал бы 22P02 на каждой строке. tenantID приходит из
 * users.tenant_id (uuid) и валиден всегда, но если будущая правка auth это
 * сломает — деградируем в admin-пул (= сегодняшнее поведение), а не в 500.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RequestUserShape {
  tenantID?: unknown;
  role?: unknown;
}

interface RequestShape {
  user?: RequestUserShape;
  originalUrl?: string;
  url?: string;
}

/**
 * Первый сегмент пути ПОСЛЕ глобального префикса `api`, в нижнем регистре:
 * `/api/manager/tenants?x=1` → 'manager'. Express сопоставляет маршруты без
 * учёта регистра, поэтому и здесь регистр не различаем. Пустая строка, если
 * пути нет. Экспортируется для статического теста.
 */
export function apiPathHead(rawUrl: string | undefined | null): string {
  const path = String(rawUrl ?? '')
    .split('?')[0]
    .split('#')[0];
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return '';
  const first = segments[0].toLowerCase();
  const head = first === 'api' ? segments[1] : segments[0];
  return (head ?? '').toLowerCase();
}

/**
 * Головы путей, где менеджеру платформы разрешён admin-пул (superuser, обход
 * RLS): кабинет менеджера, авторизация и «мой профиль». Всё остальное —
 * nil-tenant app-пул.
 */
const MANAGER_ADMIN_POOL_HEADS: ReadonlySet<string> = new Set(['manager', 'auth', 'profile']);

/** true → запрос менеджера обслуживается admin-пулом (см. шапку класса). */
export function managerUsesAdminPool(rawUrl: string | undefined | null): boolean {
  return MANAGER_ADMIN_POOL_HEADS.has(apiPathHead(rawUrl));
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<RequestShape>();
    const user = request?.user;
    // Менеджер платформы (users.tenant_id IS NULL → tenantID = NO_TENANT_ID):
    // admin-пул ТОЛЬКО на /api/manager/*, /api/auth/* и /api/profile/*, на остальном —
    // nil-tenant app-пул под RLS. Тенант принудительно nil, что бы ни лежало в токене.
    if (user && user.role === 'manager') {
      if (managerUsesAdminPool(request.originalUrl ?? request.url)) return next.handle();
      return this.runInTenant(NO_TENANT_ID, next);
    }
    const tenantId = user?.tenantID;
    if (!user || typeof tenantId !== 'string' || !UUID_RE.test(tenantId) || user.role === 'superadmin') {
      return next.handle();
    }
    return this.runInTenant(tenantId, next);
  }

  private runInTenant(tenantId: string, next: CallHandler): Observable<unknown> {
    return new Observable<unknown>((subscriber) => {
      const subscription = runWithTenant(tenantId, () => next.handle().subscribe(subscriber));
      return () => subscription.unsubscribe();
    });
  }
}
