import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { NO_TENANT_ID } from '../common/auth-cache';
import { OneCDomainService } from './one-c.domain';
import { AckDto, ConfigureConnectionDto } from './one-c.dto';
import { Connection, EntityType, ImportEvent, ImportResult } from './one-c.types';
import {
  assertCapability,
  bounded,
  canonical,
  capabilities,
  digest,
  entityType,
  hashKey,
  PILOT_NOTICE,
  textId,
  uuid,
} from './one-c.rules';

const view = (r: Connection) => ({
  id: r.id,
  pointId: r.point_id,
  status: r.status,
  configuration: r.configuration,
  mappingConfirmed: r.mapping_confirmed,
  capabilities: r.capabilities,
  keyHint: r.key_hint,
  lastSeenAt: r.last_seen_at,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});
const journalView = (r: Record<string, unknown>) => ({
  id: r.id,
  eventId: r.event_id,
  entityType: r.entity_type,
  externalId: r.external_id,
  autexaId: r.autexa_id ?? null,
  direction: r.direction,
  status: r.status,
  message: r.message,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

@Injectable()
export class OneCService {
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private domain: OneCDomainService,
  ) {}

  private owner(user: JwtPayload) {
    if (!['director', 'superadmin'].includes(user.role) || !user.tenantID || user.tenantID === NO_TENANT_ID)
      throw new ForbiddenException('Настройка доступна владельцу внутри автосервиса');
    return uuid(user.tenantID);
  }
  private async point(tenant: string, point: string, db: Pick<PoolClient, 'query'> = this.pool) {
    const { rows } = await db.query('SELECT id FROM tenant_points WHERE id=$1 AND tenant_id=$2 AND is_active=true', [
      uuid(point),
      tenant,
    ]);
    if (!rows.length) throw new BadRequestException('Выберите действующий филиал своего автосервиса');
  }
  async settings(user: JwtPayload) {
    const tenant = this.owner(user);
    const [connections, points] = await Promise.all([
      this.pool.query('SELECT * FROM one_c_connections WHERE tenant_id=$1', [tenant]),
      this.pool.query('SELECT id,name FROM tenant_points WHERE tenant_id=$1 AND is_active=true ORDER BY name,id', [
        tenant,
      ]),
    ]);
    return {
      connection: connections.rows[0] ? view(connections.rows[0]) : null,
      availablePoints: points.rows,
      pilotNotice: PILOT_NOTICE,
    };
  }
  async create(user: JwtPayload, pointId: string) {
    const tenant = this.owner(user);
    if (user.role !== 'director')
      throw new ForbiddenException('Соединение создаёт владелец из кабинета своего автосервиса');
    await this.point(tenant, pointId);
    const apiKey = `ax1c_${randomBytes(32).toString('base64url')}`;
    const { rows } = await this.pool.query(
      `INSERT INTO one_c_connections(tenant_id,point_id,created_by,capabilities,key_hash,key_hint)
       VALUES($1,$2,$3,$4::jsonb,$5,$6) ON CONFLICT(tenant_id) DO NOTHING RETURNING *`,
      [tenant, pointId, user.userID, JSON.stringify(capabilities()), hashKey(apiKey), apiKey.slice(-6)],
    );
    if (!rows.length) throw new ConflictException('Соединение уже создано');
    return { connection: view(rows[0]), apiKey };
  }
  async configure(user: JwtPayload, dto: ConfigureConnectionDto) {
    const tenant = this.owner(user);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM one_c_connections WHERE tenant_id=$1 FOR UPDATE', [tenant]);
      const current = rows[0] as Connection | undefined;
      if (!current) throw new NotFoundException('Сначала создайте соединение');
      const point = dto.pointId ?? current.point_id;
      await this.point(tenant, point, client);
      if (point !== current.point_id) {
        const history = await client.query(
          'SELECT 1 FROM one_c_events WHERE connection_id=$1 AND tenant_id=$2 LIMIT 1',
          [current.id, tenant],
        );
        if (history.rows.length) throw new ConflictException('Филиал нельзя менять после начала обмена');
      }
      const caps = capabilities(dto.capabilities ?? current.capabilities);
      const confirmed = dto.mappingConfirmed ?? current.mapping_confirmed;
      const status = dto.status ?? current.status;
      if (status === 'active' && !confirmed)
        throw new BadRequestException('Сначала подтвердите сопоставления с базой 1С');
      if (!confirmed) {
        caps.stock.import = false;
        caps.payments.import = false;
      }
      const updated = await client.query(
        `UPDATE one_c_connections SET point_id=$1,status=$2,mapping_confirmed=$3,capabilities=$4::jsonb,updated_at=now()
         WHERE id=$5 AND tenant_id=$6 RETURNING *`,
        [point, status, confirmed, JSON.stringify(caps), current.id, tenant],
      );
      await client.query('COMMIT');
      return view(updated.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  async rotateKey(user: JwtPayload) {
    const tenant = this.owner(user);
    const apiKey = `ax1c_${randomBytes(32).toString('base64url')}`;
    const { rows } = await this.pool.query(
      'UPDATE one_c_connections SET key_hash=$1,key_hint=$2,updated_at=now() WHERE tenant_id=$3 RETURNING *',
      [hashKey(apiKey), apiKey.slice(-6), tenant],
    );
    if (!rows.length) throw new NotFoundException('Соединение не найдено');
    return { connection: view(rows[0]), apiKey };
  }
  async journal(user: JwtPayload, limit?: string, offset?: string) {
    const tenant = this.owner(user);
    const [items, count] = await Promise.all([
      this.pool.query(
        'SELECT * FROM one_c_events WHERE tenant_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',
        [tenant, Math.max(1, bounded(limit, 50, 200)), bounded(offset, 0, 1_000_000)],
      ),
      this.pool.query('SELECT count(*)::int AS total FROM one_c_events WHERE tenant_id=$1', [tenant]),
    ]);
    return { items: items.rows.map(journalView), total: count.rows[0].total };
  }

  /** Called by the key guard BEFORE tenant ALS; only a hash lookup may use the admin pool. */
  async authenticate(key: string): Promise<Connection> {
    if (!/^ax1c_[A-Za-z0-9_-]{43}$/.test(key)) throw new UnauthorizedException('Некорректный ключ обмена');
    const { rows } = await this.pool.query(
      `SELECT c.* FROM one_c_connections c
       JOIN users u ON u.id=c.created_by AND u.tenant_id=c.tenant_id AND u.role='director' AND u.is_active=true AND u.deleted_at IS NULL
       JOIN tenant_points p ON p.id=c.point_id AND p.tenant_id=c.tenant_id AND p.is_active=true
       WHERE c.key_hash=$1`,
      [hashKey(key)],
    );
    if (!rows.length) throw new UnauthorizedException('Ключ обмена недействителен');
    if (rows[0].status !== 'active') throw new ForbiddenException('Обмен приостановлен владельцем');
    if (!rows[0].mapping_confirmed) throw new ForbiddenException('Сопоставления с базой 1С не подтверждены');
    return rows[0];
  }
  private async touch(connection: Connection) {
    await this.pool.query('UPDATE one_c_connections SET last_seen_at=now() WHERE id=$1 AND tenant_id=$2', [
      connection.id,
      connection.tenant_id,
    ]);
  }
  async export(connection: Connection, rawType: unknown, rawCursor?: string, rawLimit?: string) {
    const type = entityType(rawType);
    assertCapability(connection, type, 'export');
    const cursor = rawCursor ? uuid(rawCursor) : null;
    const limit = Math.max(1, bounded(rawLimit, 100, 200));
    const snapshots = await this.domain.snapshots(connection, type, cursor, limit);
    const mappings = await this.pool.query(
      `SELECT autexa_id,external_id,revision FROM one_c_mappings WHERE connection_id=$1 AND tenant_id=$2 AND entity_type=$3
       AND autexa_id=ANY($4::uuid[]) ORDER BY updated_at DESC,external_id`,
      [connection.id, connection.tenant_id, type, snapshots.map((s) => s.id)],
    );
    const items = snapshots.flatMap((s) => {
      const revision = digest(s.payload);
      // Stock imports map source movement IDs; exports map a balance snapshot.
      // Only nonempty ACK revisions identify the latter, never a movement ID.
      const candidates = mappings.rows.filter((m) => m.autexa_id === s.id && (type !== 'stock' || m.revision));
      const mapped = candidates[0];
      return candidates.some((m) => m.revision === revision)
        ? []
        : [{ autexaId: s.id, externalId: mapped?.external_id ?? null, revision, payload: s.payload }];
    });
    await this.touch(connection);
    return { items, nextCursor: snapshots.length === limit ? snapshots[snapshots.length - 1].id : null };
  }

  async import(connection: Connection, input: ImportEvent): Promise<ImportResult> {
    const event = {
      ...input,
      eventId: textId(input.eventId),
      externalId: textId(input.externalId),
      entityType: entityType(input.entityType),
    };
    assertCapability(connection, event.entityType, 'import');
    if (
      !event.payload ||
      Array.isArray(event.payload) ||
      typeof event.payload !== 'object' ||
      canonical(event.payload).length > 262144
    )
      throw new BadRequestException('Некорректный или слишком большой документ');
    const hash = digest(event);
    // A dedicated connection holds a session advisory lock, while domain methods
    // run their own transactions. It serializes bridge events for ONE object;
    // processing is durably saved BEFORE side effects, never auto-replayed.
    const client = await this.pool.connect();
    const lockKey = `${connection.id}:${event.entityType}:${event.externalId}`;
    let locked = false;
    try {
      locked = (await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [lockKey])).rows[0]
        .locked;
      if (!locked) throw new ConflictException('Документ уже обрабатывается; повторите тот же eventId');
      const inserted = await client.query(
        `INSERT INTO one_c_events(connection_id,tenant_id,event_id,entity_type,external_id,direction,payload_hash,status)
         VALUES($1,$2,$3,$4,$5,'import',$6,'processing') ON CONFLICT(connection_id,direction,event_id) DO NOTHING RETURNING *`,
        [connection.id, connection.tenant_id, event.eventId, event.entityType, event.externalId, hash],
      );
      if (!inserted.rows.length) {
        const previous = (
          await client.query(
            `SELECT * FROM one_c_events WHERE connection_id=$1 AND tenant_id=$2 AND direction='import' AND event_id=$3`,
            [connection.id, connection.tenant_id, event.eventId],
          )
        ).rows[0];
        if (!previous || previous.payload_hash !== hash)
          throw new ConflictException('eventId уже использован для другого документа');
        if (previous.status === 'processing')
          return this.finish(
            client,
            previous.id,
            connection.tenant_id,
            'needs_review',
            previous.autexa_id,
            'Предыдущая обработка прервана. Сверьте результат до повтора операции',
          );
        return { id: previous.id, status: previous.status, autexaId: previous.autexa_id, message: previous.message };
      }
      const id = inserted.rows[0].id;
      const mapping = (
        await client.query(
          `SELECT autexa_id FROM one_c_mappings WHERE connection_id=$1 AND tenant_id=$2 AND entity_type=$3 AND external_id=$4`,
          [connection.id, connection.tenant_id, event.entityType, event.externalId],
        )
      ).rows[0];
      const unresolved = await client.query(
        `SELECT 1 FROM one_c_events WHERE connection_id=$1 AND tenant_id=$2 AND entity_type=$3 AND external_id=$4
        AND direction='import' AND status IN ('processing','needs_review') AND id<>$5 LIMIT 1`,
        [connection.id, connection.tenant_id, event.entityType, event.externalId, id],
      );
      if (!mapping && unresolved.rows.length)
        return this.finish(
          client,
          id,
          connection.tenant_id,
          'needs_review',
          null,
          'Есть незавершённая операция по этому объекту. Сначала сверка и сопоставление',
        );
      let autexaId: string | null = mapping?.autexa_id ?? null;
      try {
        autexaId = await this.domain.apply(connection, event, autexaId);
        // Only an outbound ACK certifies that the remote copy has this revision.
        // A reread here could absorb a concurrent UI edit after the domain commit.
        await this.mapping(client, connection, event.entityType, event.externalId, autexaId, '');
        await this.touch(connection);
        return await this.finish(
          client,
          id,
          connection.tenant_id,
          'applied',
          autexaId,
          'Применено через операции Autexa',
        );
      } catch {
        // Even a nominal validation exception can follow a native method's commit.
        // Never infer rollback here or retry stock/money on a lost response.
        return this.finish(
          client,
          id,
          connection.tenant_id,
          'needs_review',
          autexaId,
          'Не удалось подтвердить применение. Сверьте документ и сопоставления; автоматический повтор запрещён',
        );
      }
    } finally {
      let releaseError: Error | undefined;
      try {
        if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      } catch (error) {
        // A failed unlock must destroy this session rather than return a locked
        // connection to the pool. Preserve the original operation's outcome.
        releaseError = error instanceof Error ? error : new Error('Could not release exchange lock');
      }
      client.release(releaseError);
    }
  }
  private async finish(
    db: Pick<PoolClient, 'query'>,
    id: string,
    tenant: string,
    status: ImportResult['status'],
    autexaId: string | null,
    message: string,
  ): Promise<ImportResult> {
    await db.query(
      'UPDATE one_c_events SET status=$1,autexa_id=$2,message=$3,updated_at=now() WHERE id=$4 AND tenant_id=$5',
      [status, autexaId, message, id, tenant],
    );
    return { id, status, autexaId, message };
  }
  private async mapping(
    db: Pick<PoolClient, 'query'>,
    c: Connection,
    type: EntityType,
    externalId: string,
    id: string,
    revision: string,
  ) {
    const { rows } = await db.query(
      `INSERT INTO one_c_mappings(connection_id,tenant_id,entity_type,external_id,autexa_id,revision)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(connection_id,entity_type,external_id)
      DO UPDATE SET revision=EXCLUDED.revision,updated_at=now() WHERE one_c_mappings.autexa_id=EXCLUDED.autexa_id RETURNING autexa_id`,
      [c.id, c.tenant_id, type, externalId, id, revision],
    );
    if (!rows.length) throw new ConflictException('Внешний объект уже связан с другой записью');
  }

  async ack(connection: Connection, dto: AckDto) {
    const type = entityType(dto.entityType);
    assertCapability(connection, type, 'export');
    let accepted = 0,
      needsReview = 0;
    for (const item of dto.items) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');
        const snapshot = await this.domain.snapshot(connection, type, item.autexaId, client, true);
        if (digest(snapshot.payload) !== item.revision) throw new ConflictException('Объект изменился после выгрузки');
        await this.mapping(client, connection, type, textId(item.externalId), uuid(item.autexaId), item.revision);
        await client.query(
          `INSERT INTO one_c_events(connection_id,tenant_id,event_id,entity_type,external_id,autexa_id,direction,payload_hash,status,message)
          VALUES($1,$2,$3,$4,$5,$6,'export',$7,'exported','Подтверждено мостом 1С') ON CONFLICT(connection_id,direction,event_id) DO UPDATE SET status='exported',message=EXCLUDED.message,updated_at=now()`,
          [
            connection.id,
            connection.tenant_id,
            `ack:${type}:${item.autexaId}:${item.revision}`,
            type,
            item.externalId,
            item.autexaId,
            item.revision,
          ],
        );
        await client.query('COMMIT');
        accepted += 1;
      } catch {
        await client.query('ROLLBACK');
        needsReview += 1;
        await client.query(
          `INSERT INTO one_c_events(connection_id,tenant_id,event_id,entity_type,external_id,autexa_id,direction,payload_hash,status,message)
          VALUES($1,$2,$3,$4,$5,$6,'export',$7,'needs_review','Подтверждение выгрузки не принято: версия или сопоставление изменились')
          ON CONFLICT(connection_id,direction,event_id) DO NOTHING`,
          [
            connection.id,
            connection.tenant_id,
            `ack:${type}:${item.autexaId}:${item.revision}`,
            type,
            item.externalId,
            item.autexaId,
            item.revision,
          ],
        );
      } finally {
        client.release();
      }
    }
    await this.touch(connection);
    return { accepted, needsReview };
  }
}
