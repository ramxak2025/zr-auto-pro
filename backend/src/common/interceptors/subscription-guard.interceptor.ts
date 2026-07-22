import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Pool } from 'pg';
import { ttlCache } from '../ttl-cache';
import { NO_TENANT_ID } from '../auth-cache';

/**
 * SubscriptionGuardInterceptor — enforcement подписки тенанта (R10).
 *
 * До этой волны приостановка тенанта (tenants.is_active=false, superadmin
 * suspend) и истёкшая subscription_end НЕ рубили запросы вовсе: заблокированный
 * автосервис продолжал полноценно работать через API. Теперь любой запрос
 * пользователя такого тенанта получает 403 с кодом SUBSCRIPTION_BLOCKED.
 *
 * ── Почему interceptor, а не guard (та же причина, что у
 *    TenantWriteGuardInterceptor) ──────────────────────────────────────────────
 * JwtAuthGuard в этом приложении вешается ПЕР-КОНТРОЛЛЕРНО (main.ts глобально
 * регистрирует только RateLimitGuard). Глобальный guard исполнялся бы ДО
 * контроллерного JwtAuthGuard — request.user ещё пуст. Interceptor исполняется
 * ПОСЛЕ всех guards (user проверен и присвоен); throw до next.handle() чисто
 * уходит через HttpExceptionFilter типизированным 403, handler не запускается.
 *
 * ── Семантика ──────────────────────────────────────────────────────────────
 *   • 403, НЕ 401 — клиент не должен разлогинивать пользователя: он остаётся
 *     в приложении и видит paywall-экран (код SUBSCRIPTION_BLOCKED различим).
 *   • Блок: tenants.is_active = false (suspend / легаси-отключение) ИЛИ
 *     subscription_end в прошлом. subscription_end NULL = бессрочно.
 *   • Исключения:
 *       – superadmin (платформенные операции + импersonation-обслуживание);
 *       – пользователи без тенанта (нечего блокировать);
 *       – публичные роуты (нет request.user — interceptor их не видит);
 *       – whitelist-пути (ALLOWED_PREFIXES): /auth/* (login/logout/me — вход и
 *         выход должны работать, me показывает статус подписки), /subscription
 *         (paywall-экрану нужен статус, чтобы показать «продлите»),
 *         /account/* (удаление аккаунта — требование App Store), /health*
 *         (пробы), /push* (управление своим push-токеном).
 *
 * ── Кэш ────────────────────────────────────────────────────────────────────
 * Статус тенанта кэшируется в ttlCache на 30с (как auth-hop cache) — один
 * SELECT на тенанта в окно, а не на каждый запрос. Блокировка сравнивает
 * даты В МОМЕНТ запроса (кэшируется сырой статус, не решение), так что
 * истечение подписки внутри TTL-окна не проскакивает. suspend/unsuspend
 * инвалидируют кэш немедленно (TenantsService), иначе — максимум 30с задержки.
 */

const SUBSCRIPTION_CACHE_NAMESPACE = 'tenant-subscription:';
const SUBSCRIPTION_CACHE_TTL_MS = 30_000;

/** Нормализованный статус подписки тенанта (кэшируемое значение). */
interface TenantSubscriptionStatus {
  /** false, если строки tenants нет (fail-open — чужие guards разберутся). */
  found: boolean;
  isActive: boolean;
  /** epoch ms конца подписки или null (бессрочно). */
  subscriptionEndMs: number | null;
}

function subscriptionCacheKey(tenantID: string): string {
  return `${SUBSCRIPTION_CACHE_NAMESPACE}${tenantID}`;
}

/**
 * Сбросить кэшированный статус подписки тенанта — вызывается из
 * TenantsService.suspend/unsuspend, чтобы блокировка/разблокировка действовала
 * со следующего запроса, а не через TTL.
 */
export function invalidateTenantSubscription(tenantID: string): void {
  ttlCache.invalidate(subscriptionCacheKey(tenantID));
}

@Injectable()
export class SubscriptionGuardInterceptor implements NestInterceptor {
  /**
   * Path-prefix whitelist (первый сегмент пути после глобального `api`).
   * Синхронизирован по стилю с TenantWriteGuardInterceptor.ALLOWED_PREFIXES.
   */
  private static readonly ALLOWED_PREFIXES = ['auth', 'subscription', 'account', 'health', 'push'];

  constructor(private readonly pool: Pool) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<{
      path?: string;
      url?: string;
      user?: { role?: string; tenantID?: string };
    }>();

    const user = request?.user;
    // Публичные роуты (нет user) и superadmin — вне enforcement'а.
    if (!user || user.role === 'superadmin') {
      return next.handle();
    }

    const tenantID = user.tenantID;
    // Без тенанта блокировать нечего (sentinel уже отфильтрован isTenantLess-путями).
    if (!tenantID || tenantID === NO_TENANT_ID) {
      return next.handle();
    }

    if (this.isAllowedPrefix(request?.path || request?.url)) {
      return next.handle();
    }

    const status = await this.loadStatus(tenantID);
    if (!status.found) {
      return next.handle(); // тенант исчез — не наша ответственность (404/403 дадут другие слои)
    }

    const expired = status.subscriptionEndMs !== null && status.subscriptionEndMs < Date.now();
    if (!status.isActive || expired) {
      // 403 (не 401!) — клиент НЕ разлогинивает, а показывает paywall по коду.
      throw new ForbiddenException({
        message: 'Подписка приостановлена или истекла. Продлите подписку, чтобы продолжить работу.',
        code: 'SUBSCRIPTION_BLOCKED',
      });
    }

    return next.handle();
  }

  /** Статус тенанта с 30с TTL-кэшем (сырой статус, решение — на каждом запросе). */
  private loadStatus(tenantID: string): Promise<TenantSubscriptionStatus> {
    return ttlCache.wrap(subscriptionCacheKey(tenantID), SUBSCRIPTION_CACHE_TTL_MS, async () => {
      const { rows } = await this.pool.query(`SELECT is_active, subscription_end FROM tenants WHERE id = $1`, [
        tenantID,
      ]);
      if (rows.length === 0) {
        return { found: false, isActive: true, subscriptionEndMs: null } satisfies TenantSubscriptionStatus;
      }
      const raw = rows[0].subscription_end;
      const endMs = raw ? new Date(raw).getTime() : null;
      return {
        found: true,
        isActive: rows[0].is_active !== false,
        subscriptionEndMs: endMs !== null && Number.isFinite(endMs) ? endMs : null,
      } satisfies TenantSubscriptionStatus;
    });
  }

  /**
   * True, когда путь (после глобального `api`-префикса, без query) начинается с
   * whitelist-сегмента — байт-в-байт логика TenantWriteGuardInterceptor.
   */
  private isAllowedPrefix(url: string | undefined): boolean {
    if (!url) return false;
    const path = url.split('?')[0].replace(/^\/+/, '');
    const segments = path.split('/');
    const head = segments[0] === 'api' ? segments[1] : segments[0];
    if (!head) return false;
    return SubscriptionGuardInterceptor.ALLOWED_PREFIXES.includes(head);
  }
}
