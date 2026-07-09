import { Module, Global, OnModuleDestroy, Inject } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Pool } from 'pg';
import { getDbConfig, getAppDbConfig } from './common/db-config';
import { TenantAwarePool } from './common/tenant-pool';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { TenantWriteGuardInterceptor } from './common/interceptors/tenant-write-guard.interceptor';

const PG_POOL = 'PG_POOL';

/**
 * PG_POOL теперь — TenantAwarePool (волна B, RLS): Pool-совместимая обёртка
 * над admin-пулом (как раньше) и опциональным app-пулом роли autexa_app под
 * Row Level Security. Все 60+ сервисов инжектят токен как раньше и зовут
 * query()/connect() — маршрутизацию по CLS-контексту тенанта делает обёртка.
 *
 * TenantContextInterceptor зарегистрирован здесь же (модуль @Global, APP_INTERCEPTOR
 * работает из любого модуля): он выполняется ПОСЛЕ глобальных guard'ов
 * (JwtAuthGuard уже положил request.user) и оборачивает хендлер в CLS-контекст
 * тенанта. Без DB_APP_PASSWORD оба компонента инертны.
 *
 * TenantWriteGuardInterceptor зарегистрирован ПЕРЕД контекстным (порядок массива =
 * порядок применения): тоже интерцептор, а не APP_GUARD, потому что JwtAuthGuard
 * в этом проекте вешается по-контроллерно — глобальный guard отработал бы ДО него
 * (request.user ещё нет). Он отклоняет мутацию tenant-less суперадмина (409 через
 * HttpExceptionFilter) до вызова хендлера, чтобы ни один INSERT с sentinel-тенантом
 * не выстрелил и не упал в FK-violation → 500. Для всех остальных — no-op.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () => {
        const adminPool = new Pool(getDbConfig());
        const appConfig = getAppDbConfig();
        const appPool = appConfig ? new Pool(appConfig) : null;
        return new TenantAwarePool(adminPool, appPool);
      },
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantWriteGuardInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantContextInterceptor,
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private pool: TenantAwarePool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}

export { PG_POOL };
