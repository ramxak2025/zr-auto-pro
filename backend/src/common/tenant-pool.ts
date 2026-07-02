import { Logger } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getCurrentTenantId } from './tenant-context';

/**
 * TenantAwarePool — Pool-совместимая обёртка над ДВУМЯ пулами (волна B, RLS).
 *
 *   adminPool — текущее подключение (в проде — суперпользователь postgres):
 *               миграции, кроны, безтенантные пути, режим совместимости.
 *   appPool   — роль autexa_app (LOGIN, NOSUPERUSER, NOBYPASSRLS): весь
 *               тенантный трафик. Для неё действуют политики tenant_isolation
 *               из миграции 112 — забытый WHERE tenant_id не отдаёт чужие
 *               строки. Существует только если задан DB_APP_PASSWORD.
 *
 * Правила маршрутизации (прозрачно для всех 60+ сервисов, инжектящих PG_POOL):
 *   • CLS-контекст тенанта есть И appPool активен → app-пул:
 *       query():   BEGIN; SELECT set_config('app.tenant_id', $tid, true);
 *                  <запрос>; COMMIT.  set_config с is_local=true умирает вместе
 *                  с транзакцией — GUC НЕ утекает в пул ни при commit, ни при
 *                  rollback.
 *       connect(): клиент с сессионным set_config + пропатченный release(),
 *                  который делает RESET app.tenant_id ПЕРЕД возвратом соединения
 *                  в пул (иначе следующий чекаут другого тенанта унаследовал бы
 *                  чужой GUC). Если RESET не удался — соединение уничтожается,
 *                  а не возвращается (release(err) ⇒ pg дропает сокет).
 *   • контекста нет ИЛИ DB_APP_PASSWORD не задан → adminPool, поведение
 *     байт-в-байт как до этой волны.
 *
 * ВАЖНО про default-deny: политики построены на current_setting(...,true) —
 * без GUC они не пропускают ничего. Поэтому любой путь, «потерявший» контекст
 * (например, event-emitter-колбэк вне ALS), не ломается и не открывает дыру —
 * он просто уходит в adminPool, т.е. в сегодняшнее поведение.
 */
export class TenantAwarePool {
  private readonly logger = new Logger('TenantAwarePool');

  constructor(
    private readonly adminPool: Pool,
    private readonly appPool: Pool | null,
  ) {
    if (this.appPool) {
      this.logger.log('RLS dual-pool mode ACTIVE: tenant traffic → role autexa_app (row level security)');
    } else {
      this.logger.log('RLS dual-pool mode OFF (DB_APP_PASSWORD not set) — single admin pool, legacy behaviour');
    }
    // pg Pool кидает 'error' на idle-клиентах (обрыв сети, рестарт PG). Без
    // подписчика это уронило бы процесс; admin-пул исторически жил без
    // подписчика только потому, что был один. Логируем и живём — следующий
    // checkout создаст свежее соединение.
    this.adminPool.on('error', (err) => this.logger.error(`admin pool idle client error: ${err.message}`));
    this.appPool?.on('error', (err) => this.logger.error(`app pool idle client error: ${err.message}`));
  }

  /** Активен ли второй (RLS) контур. */
  get isRlsActive(): boolean {
    return this.appPool !== null;
  }

  /**
   * Одиночный запрос. В тенантном контексте — через app-пул внутри транзакции
   * с транзакционно-локальным GUC (см. шапку класса), иначе — admin-пул.
   */
  async query<R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<R>> {
    const tenantId = getCurrentTenantId();
    if (!this.appPool || !tenantId) {
      return this.adminPool.query<R>(text, params as unknown[]);
    }
    const client = await this.appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      const result = await client.query<R>(text, params as unknown[]);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* соединение уже мертво — release(err) ниже его уничтожит */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Чекаут клиента для многошаговых транзакций (checks.create, imports, …).
   * В тенантном контексте — app-клиент с УЖЕ выставленным сессионным GUC:
   * сервисный код делает свои BEGIN/COMMIT как раньше и ничего не знает про
   * RLS. release() пропатчен на RESET GUC перед возвратом в пул.
   */
  async connect(): Promise<PoolClient> {
    const tenantId = getCurrentTenantId();
    if (!this.appPool || !tenantId) {
      return this.adminPool.connect();
    }
    const client = await this.appPool.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantId]);
    } catch (err) {
      // Полусконфигурированная сессия не должна вернуться в пул — уничтожаем.
      client.release(err as Error);
      throw err;
    }
    return this.patchRelease(client);
  }

  /** Закрыть оба пула (graceful shutdown из DatabaseModule.onModuleDestroy). */
  async end(): Promise<void> {
    await this.adminPool.end();
    if (this.appPool) {
      await this.appPool.end();
    }
  }

  /**
   * КРИТИЧНО: сессионный GUC обязан быть снят до возврата соединения в пул,
   * иначе следующий чекаут (другой запрос, другой тенант, но без set — путей
   * таких нет, однако инвариант должен держаться сам по себе) увидел бы чужой
   * app.tenant_id. RESET возвращает кастомный GUC к reset-значению '' — политики
   * через NULLIF(...,'') трактуют его как «нет тенанта» = default-deny.
   * Не смогли сбросить (умершее соединение, зависшая транзакция) — уничтожаем
   * соединение целиком: чистота пула важнее переиспользования сокета.
   */
  private patchRelease(client: PoolClient): PoolClient {
    const originalRelease = client.release.bind(client);
    let released = false;
    client.release = (err?: Error | boolean): void => {
      if (released) return; // повторный release до завершения RESET — глотаем
      released = true;
      if (err) {
        // Путь destroy: pg дропает соединение, сессия (и её GUC) умирает.
        originalRelease(err);
        return;
      }
      client.query('RESET app.tenant_id').then(
        () => originalRelease(),
        (resetErr) => {
          this.logger.warn(`RESET app.tenant_id failed, destroying connection: ${resetErr?.message ?? resetErr}`);
          originalRelease(true);
        },
      );
    };
    return client;
  }
}
