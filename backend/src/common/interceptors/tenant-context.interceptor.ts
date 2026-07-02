import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
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

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const request = context.switchToHttp().getRequest<{ user?: RequestUserShape }>();
    const user = request?.user;
    const tenantId = user?.tenantID;
    if (!user || typeof tenantId !== 'string' || !UUID_RE.test(tenantId) || user.role === 'superadmin') {
      return next.handle();
    }
    return new Observable<unknown>((subscriber) => {
      const subscription = runWithTenant(tenantId, () => next.handle().subscribe(subscriber));
      return () => subscription.unsubscribe();
    });
  }
}
