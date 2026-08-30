import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { userHasPermission } from '../common/guards/permissions.guard';
import { JwtPayload } from '../common/decorators/current-user.decorator';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Мульти-точки (миграция 156, tenant_points): несколько автосервисов у одного
 * тенанта. Точки заводит ТОЛЬКО суперадмин из ЛК (их количество и есть лимит);
 * тенант переключается между точками и назначает сотрудников на точки.
 * 0 или 1 точка = одноточечный режим, UI ничего не показывает.
 * НЕ путать с tenant_locations («места» внутри двора, Round 14).
 */
@Injectable()
export class PointsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapPoint(row: any) {
    return {
      id: row.id,
      name: row.name,
      address: row.address ?? null,
      sortOrder: typeof row.sort_order === 'number' ? row.sort_order : parseInt(row.sort_order, 10) || 0,
      isActive: !!row.is_active,
      createdAt: row.created_at,
    };
  }

  // ── Тенант-сторона ──────────────────────────────────────────────────────

  /**
   * Точки своего тенанта для приложения: живые точки + назначения сотрудников
   * (memberIds — для экрана управления) + текущая точка запрашивающего.
   */
  async listForTenant(user: JwtPayload) {
    const [{ rows: points }, { rows: members }, { rows: me }] = await Promise.all([
      this.pool.query(
        `SELECT * FROM tenant_points WHERE tenant_id=$1 AND is_active=true
         ORDER BY sort_order ASC, lower(name) ASC`,
        [user.tenantID],
      ),
      this.pool.query(`SELECT user_id, point_id FROM user_points WHERE tenant_id=$1`, [user.tenantID]),
      this.pool.query(`SELECT current_point_id FROM users WHERE id=$1 AND tenant_id=$2`, [user.userID, user.tenantID]),
    ]);
    const byPoint = new Map<string, string[]>();
    for (const m of members) {
      const list = byPoint.get(m.point_id) ?? [];
      list.push(m.user_id);
      byPoint.set(m.point_id, list);
    }
    return {
      points: points.map((p) => ({ ...this.mapPoint(p), memberIds: byPoint.get(p.id) ?? [] })),
      currentPointId: me[0]?.current_point_id ?? null,
    };
  }

  /**
   * Переключить свою текущую точку. null = сбросить («все точки» у владельца).
   * Держатель user_management (owner-class/админ) переключается свободно;
   * остальные (мастера) — только на назначенные им точки; сотрудник БЕЗ
   * назначений не ограничен (безопасный дефолт внедрения).
   */
  async switchPoint(user: JwtPayload, pointId: string | null) {
    if (pointId !== null) {
      if (!UUID_RE.test(pointId)) throw new BadRequestException({ message: 'Точка не найдена' });
      const { rows } = await this.pool.query(
        `SELECT id FROM tenant_points WHERE id=$1 AND tenant_id=$2 AND is_active=true`,
        [pointId, user.tenantID],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });

      if (!userHasPermission(user, 'user_management')) {
        const { rows: mine } = await this.pool.query(
          `SELECT point_id FROM user_points WHERE user_id=$1 AND tenant_id=$2`,
          [user.userID, user.tenantID],
        );
        const allowed = mine.length === 0 || mine.some((r) => r.point_id === pointId);
        if (!allowed) throw new ForbiddenException({ message: 'Вы не назначены на эту точку' });
      }
    }
    await this.pool.query(`UPDATE users SET current_point_id=$1 WHERE id=$2 AND tenant_id=$3`, [
      pointId,
      user.userID,
      user.tenantID,
    ]);
    return { currentPointId: pointId };
  }

  /**
   * Заменить состав сотрудников точки (user_management). Пустой массив =
   * никто не назначен явно; сотрудники без назначений не ограничены.
   */
  async setMembers(tenantID: string, pointId: string, userIds: string[]) {
    if (!UUID_RE.test(pointId)) throw new NotFoundException({ message: 'Точка не найдена' });
    const clean = [...new Set((userIds ?? []).filter((id) => typeof id === 'string' && UUID_RE.test(id)))];
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT id FROM tenant_points WHERE id=$1 AND tenant_id=$2`, [
        pointId,
        tenantID,
      ]);
      if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
      await client.query(`DELETE FROM user_points WHERE point_id=$1 AND tenant_id=$2`, [pointId, tenantID]);
      if (clean.length > 0) {
        // Только сотрудники СВОЕГО тенанта — чужие id молча отбрасываются JOIN'ом.
        await client.query(
          `INSERT INTO user_points (user_id, point_id, tenant_id)
           SELECT u.id, $1, $2 FROM users u WHERE u.tenant_id=$2 AND u.id = ANY($3::uuid[])
           ON CONFLICT DO NOTHING`,
          [pointId, tenantID, clean],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const { rows: after } = await this.pool.query(
      `SELECT user_id FROM user_points WHERE point_id=$1 AND tenant_id=$2`,
      [pointId, tenantID],
    );
    return { memberIds: after.map((r) => r.user_id) };
  }

  // ── Суперадмин (ЛК, admin-пул) ──────────────────────────────────────────

  /** Все точки тенанта (живые + архив) для карточки тенанта в ЛК. */
  async adminList(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM tenant_points WHERE tenant_id=$1 ORDER BY is_active DESC, sort_order ASC, lower(name) ASC`,
      [tenantId],
    );
    return rows.map((r) => this.mapPoint(r));
  }

  /** Создать точку тенанту (суперадмин). Дубль живого имени → 409. */
  async adminCreate(tenantId: string, dto: { name?: string; address?: string }) {
    const name = String(dto?.name ?? '').trim();
    if (!name) throw new BadRequestException({ message: 'Укажите название точки' });
    const address = String(dto?.address ?? '').trim() || null;
    const { rows: t } = await this.pool.query(`SELECT id FROM tenants WHERE id=$1`, [tenantId]);
    if (t.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });
    try {
      const { rows } = await this.pool.query(
        `INSERT INTO tenant_points (tenant_id, name, address, sort_order)
         VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order)+1 FROM tenant_points WHERE tenant_id=$1), 0))
         RETURNING *`,
        [tenantId, name, address],
      );
      return this.mapPoint(rows[0]);
    } catch (err: any) {
      // 23505 частичного uq-индекса: живой дубль имени.
      if (err?.code === '23505') throw new ConflictException({ message: 'Точка с таким названием уже есть' });
      throw err;
    }
  }

  /** Переименовать / сменить адрес / архив-разархив (суперадмин). */
  async adminUpdate(
    tenantId: string,
    pointId: string,
    dto: { name?: string; address?: string; isActive?: boolean; sortOrder?: number },
  ) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (dto.name !== undefined) {
      const name = String(dto.name).trim();
      if (!name) throw new BadRequestException({ message: 'Укажите название точки' });
      sets.push(`name=$${idx++}`);
      vals.push(name);
    }
    if (dto.address !== undefined) {
      sets.push(`address=$${idx++}`);
      vals.push(String(dto.address ?? '').trim() || null);
    }
    if (dto.isActive !== undefined) {
      sets.push(`is_active=$${idx++}`);
      vals.push(!!dto.isActive);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`sort_order=$${idx++}`);
      vals.push(Number(dto.sortOrder) || 0);
    }
    if (sets.length === 0) {
      const list = await this.adminList(tenantId);
      const found = list.find((p) => p.id === pointId);
      if (!found) throw new NotFoundException({ message: 'Точка не найдена' });
      return found;
    }
    vals.push(pointId, tenantId);
    try {
      const { rows } = await this.pool.query(
        `UPDATE tenant_points SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
        vals,
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
      return this.mapPoint(rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException({ message: 'Точка с таким названием уже есть' });
      throw err;
    }
  }

  /**
   * «Удалить» точку = АРХИВ (is_active=false), паттерн 146: старые чеки точку
   * сохраняют, пикеры не предлагают, имя освобождается. Заодно чистим
   * current_point_id у сотрудников, чтобы никто не «застрял» на архивной точке.
   */
  async adminArchive(tenantId: string, pointId: string) {
    const { rows } = await this.pool.query(
      `UPDATE tenant_points SET is_active=false WHERE id=$1 AND tenant_id=$2 RETURNING id`,
      [pointId, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
    await this.pool.query(`UPDATE users SET current_point_id=NULL WHERE current_point_id=$1 AND tenant_id=$2`, [
      pointId,
      tenantId,
    ]);
    return { success: true };
  }
}
