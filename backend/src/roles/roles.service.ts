import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { invalidateAuthUser } from '../common/auth-cache';
import { mergeRoleMatrix, RawRoleMatrix, sanitizeRoleMatrix } from '../common/role-matrix';

/** Shape returned to clients — mirrors `Role` in shared/types/index.ts. */
export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  matrix: RawRoleMatrix;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

const SELECT_COLUMNS = `id, tenant_id, name, description, is_system, COALESCE(matrix, '{}') AS matrix, COALESCE(sort, 0) AS sort, created_at, updated_at`;

/**
 * Роли (миграция 114): системные (tenant_id IS NULL — «Мастер», «Администратор»,
 * «Директор», сеются миграцией) + кастомные роли тенанта. Матрица роли — база
 * эффективных permissions назначенных пользователей (см. common/role-matrix.ts
 * и jwt.strategy); персональные users.permissions действуют поверх.
 *
 * Все запросы несут явный `WHERE tenant_id` (режим совместимости, admin-пул);
 * в RLS-режиме политики из 114 дополнительно гарантируют то же самое на уровне
 * БД: системные строки читаемы, но не записываемы из тенантного контекста.
 */
@Injectable()
export class RolesService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private toRow(r: {
    id: string;
    name: string;
    description: string | null;
    is_system: boolean;
    matrix: unknown;
    sort: number | string;
    created_at: string | Date;
    updated_at: string | Date;
  }): RoleRow {
    const matrix = typeof r.matrix === 'string' ? JSON.parse(r.matrix) : r.matrix;
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      isSystem: !!r.is_system,
      matrix: (matrix && typeof matrix === 'object' ? matrix : {}) as RawRoleMatrix,
      sort: parseInt(String(r.sort), 10) || 0,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    };
  }

  /** Системные + свои, системные сверху (is_system DESC), затем по sort. */
  async list(tenantID: string): Promise<RoleRow[]> {
    const { rows } = await this.pool.query(
      `SELECT ${SELECT_COLUMNS}
       FROM roles
       WHERE tenant_id = $1 OR tenant_id IS NULL
       ORDER BY is_system DESC, sort ASC, name ASC`,
      [tenantID],
    );
    return rows.map((r) => this.toRow(r));
  }

  /**
   * Загрузить роль, ВИДИМУЮ тенанту (свою или системную). 404 на чужую —
   * существование ролей другого тенанта не раскрывается.
   */
  private async loadVisible(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT ${SELECT_COLUMNS} FROM roles WHERE id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Роль не найдена' });
    return rows[0];
  }

  /**
   * Создать кастомную роль тенанта. `copyFromRoleId` (системная или своя) даёт
   * базовую матрицу; `matrix` из body двухуровнево сливается поверх копии.
   * Без copyFrom — только sanitized `matrix` (или пустая = ничего не разрешено:
   * flatten fail-closed).
   */
  async create(
    tenantID: string,
    dto: {
      name: string;
      description?: string;
      matrix?: Record<string, Record<string, unknown>>;
      copyFromRoleId?: string;
      sort?: number;
    },
  ): Promise<RoleRow> {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException({ message: 'Название роли обязательно' });

    let matrix: RawRoleMatrix = sanitizeRoleMatrix(dto.matrix ?? {});
    if (dto.copyFromRoleId) {
      const source = await this.loadVisible(dto.copyFromRoleId, tenantID);
      const sourceMatrix = sanitizeRoleMatrix(
        typeof source.matrix === 'string' ? JSON.parse(source.matrix) : source.matrix,
      );
      matrix = mergeRoleMatrix(sourceMatrix, matrix);
    }

    try {
      const { rows } = await this.pool.query(
        `INSERT INTO roles (tenant_id, name, description, is_system, matrix, sort)
         VALUES ($1, $2, $3, false, $4::jsonb, $5)
         RETURNING ${SELECT_COLUMNS}`,
        [tenantID, name, dto.description?.trim() || null, JSON.stringify(matrix), dto.sort ?? 0],
      );
      return this.toRow(rows[0]);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        throw new BadRequestException({ message: 'Роль с таким названием уже существует' });
      }
      throw err;
    }
  }

  /**
   * Обновить СВОЮ роль. Системная (tenant_id IS NULL) → 403 «создайте копию».
   * Присланная matrix заменяет сохранённую целиком (sanitized). После записи
   * сбрасываем auth-кэш всех пользователей на этой роли — смена матрицы
   * действует со следующего запроса, а не через TTL.
   */
  async update(
    id: string,
    tenantID: string,
    patch: { name?: string; description?: string; matrix?: Record<string, Record<string, unknown>>; sort?: number },
  ): Promise<RoleRow> {
    const existing = await this.loadVisible(id, tenantID);
    if (existing.tenant_id === null || existing.is_system) {
      throw new ForbiddenException({ message: 'Системную роль нельзя изменить — создайте копию' });
    }

    try {
      const { rows } = await this.pool.query(
        `UPDATE roles
         SET name = COALESCE($3, name),
             description = COALESCE($4, description),
             matrix = COALESCE($5::jsonb, matrix),
             sort = COALESCE($6, sort),
             updated_at = now()
         WHERE id = $1 AND tenant_id = $2
         RETURNING ${SELECT_COLUMNS}`,
        [
          id,
          tenantID,
          patch.name !== undefined ? patch.name.trim() : null,
          patch.description !== undefined ? patch.description.trim() : null,
          patch.matrix !== undefined ? JSON.stringify(sanitizeRoleMatrix(patch.matrix)) : null,
          patch.sort ?? null,
        ],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Роль не найдена' });

      if (patch.matrix !== undefined) {
        // База эффективных прав изменилась у всех, кто на этой роли, — не ждём TTL.
        const { rows: assigned } = await this.pool.query(`SELECT id FROM users WHERE role_id = $1 AND tenant_id = $2`, [
          id,
          tenantID,
        ]);
        for (const u of assigned) invalidateAuthUser(u.id);
      }
      return this.toRow(rows[0]);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === '23505') {
        throw new BadRequestException({ message: 'Роль с таким названием уже существует' });
      }
      throw err;
    }
  }

  /**
   * Удалить СВОЮ роль. Системная → 403. Если на роли числятся действующие
   * сотрудники → 400 с count («Сначала переназначьте N сотрудников»). Уволенные
   * / удалённые (dismissed/purged) не блокируют удаление — их role_id обнуляет
   * FK ON DELETE SET NULL, при восстановлении сотрудник безопасно вернётся к
   * легаси-дефолтам своей строковой роли.
   */
  async remove(id: string, tenantID: string): Promise<{ success: true }> {
    const existing = await this.loadVisible(id, tenantID);
    if (existing.tenant_id === null || existing.is_system) {
      throw new ForbiddenException({ message: 'Системную роль нельзя удалить' });
    }

    const { rows: countRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS count
       FROM users
       WHERE role_id = $1 AND tenant_id = $2 AND dismissed_at IS NULL AND purged_at IS NULL`,
      [id, tenantID],
    );
    const count = countRows[0]?.count ?? 0;
    if (count > 0) {
      throw new BadRequestException({
        message: `Сначала переназначьте ${count} сотрудников на другую роль`,
        code: 'ROLE_HAS_USERS',
        count,
      });
    }

    const { rowCount } = await this.pool.query(`DELETE FROM roles WHERE id = $1 AND tenant_id = $2`, [id, tenantID]);
    if (!rowCount) throw new NotFoundException({ message: 'Роль не найдена' });
    return { success: true };
  }
}
