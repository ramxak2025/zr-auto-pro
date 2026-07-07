import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { invalidateAuthUser } from '../common/auth-cache';
import { mergeRoleMatrix, RawRoleMatrix, sanitizeRoleMatrix } from '../common/role-matrix';

/** Разбор jsonb-строки без падения: кривой JSON → {} (fail-closed, ничего не выдаёт). */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Стабильный ключ системной роли (миграция 121). NULL у кастомных ролей. */
export type RoleSystemKey = 'master' | 'admin' | 'director';

/** Shape returned to clients — mirrors `Role` in shared/types/index.ts. */
export interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  matrix: RawRoleMatrix;
  sort: number;
  /** 'master'|'admin'|'director' у системной роли и её тенантного override; null у кастомной. */
  systemKey: RoleSystemKey | null;
  /** true ТОЛЬКО у «Директора» — вечно read-only, полные права. Иначе редактируема. */
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

const SELECT_COLUMNS = `id, tenant_id, name, description, is_system, COALESCE(matrix, '{}') AS matrix, COALESCE(sort, 0) AS sort, system_key, created_at, updated_at`;

/** Сырая строка roles из БД (набор колонок SELECT_COLUMNS). */
interface RoleRowRaw {
  id: string;
  tenant_id?: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
  matrix: unknown;
  sort: number | string;
  system_key: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

/** «Директор» — единственная навсегда неизменяемая системная роль (ITEM 5). */
const DIRECTOR_KEY: RoleSystemKey = 'director';

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

  /** jsonb-матрица приходит объектом (node-pg) или строкой (легаси text) — нормализуем. */
  private parseMatrix(raw: unknown): RawRoleMatrix {
    const m = typeof raw === 'string' ? safeJsonParse(raw) : raw;
    return (m && typeof m === 'object' && !Array.isArray(m) ? m : {}) as RawRoleMatrix;
  }

  private toRow(r: RoleRowRaw): RoleRow {
    const systemKey = (r.system_key ?? null) as RoleSystemKey | null;
    return {
      id: r.id,
      name: r.name,
      description: r.description ?? null,
      isSystem: !!r.is_system,
      matrix: this.parseMatrix(r.matrix),
      sort: parseInt(String(r.sort), 10) || 0,
      systemKey,
      // Редактируемо всё, КРОМЕ «Директора» (ITEM 5): он остаётся глобальным
      // шаблоном с полными правами и никогда не материализуется.
      locked: systemKey === DIRECTOR_KEY,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    };
  }

  /**
   * Системные + свои, системные сверху (is_system DESC), затем по sort.
   *
   * ITEM 5 — если у тенанта есть override системной роли (тенантная строка с тем
   * же system_key), ГЛОБАЛЬНЫЙ шаблон этого system_key СКРЫВАЕТСЯ и на его месте
   * показывается override (никаких дублей «Мастер»). Порядок сохраняется:
   * override несёт sort глобала и is_system=true, поэтому стоит в том же слоте.
   */
  async list(tenantID: string): Promise<RoleRow[]> {
    const { rows } = await this.pool.query(
      `SELECT ${SELECT_COLUMNS}
       FROM roles
       WHERE tenant_id = $1 OR tenant_id IS NULL
       ORDER BY is_system DESC, sort ASC, name ASC`,
      [tenantID],
    );
    const overriddenKeys = new Set<string>(
      rows.filter((r) => r.tenant_id !== null && r.system_key).map((r) => r.system_key as string),
    );
    return rows
      .filter((r) => !(r.tenant_id === null && r.system_key && overriddenKeys.has(r.system_key as string)))
      .map((r) => this.toRow(r));
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
   * Обновить роль. Три ветки (ITEM 5):
   *
   *   1. Кастомная роль тенанта (is_system=false)     → правка на месте, matrix
   *      ЗАМЕНЯЕТ сохранённую целиком (прежнее поведение, ноль регрессии).
   *   2. Тенантный override системной роли             → правка на месте, matrix
   *      МЕРЖИТСЯ поверх сохранённой (override всегда держит ПОЛНУЮ матрицу, а
   *      частичный патч не должен обнулить соседние ячейки).
   *   3. ГЛОБАЛЬНАЯ системная роль «Мастер»/«Администратор» → copy-on-write:
   *      материализуем тенантный override и переводим на него пользователей
   *      этого тенанта. Глобальная строка НЕ трогается.
   *
   * «Директор» — ветка 3 запрещена: 403, роль остаётся глобальным шаблоном с
   * полными правами (директор и так обходит все гейты по строковой роли).
   *
   * После записи сбрасываем auth-кэш затронутых пользователей — новая матрица
   * действует со следующего запроса, а не через TTL.
   */
  async update(
    id: string,
    tenantID: string,
    patch: { name?: string; description?: string; matrix?: Record<string, Record<string, unknown>>; sort?: number },
  ): Promise<RoleRow> {
    const existing = await this.loadVisible(id, tenantID);
    const systemKey = (existing.system_key ?? null) as RoleSystemKey | null;

    // «Директор» — навсегда read-only, полные права (ITEM 5). Ловит и глобальную
    // строку, и (защитно) любой director-override, которого быть не должно.
    if (systemKey === DIRECTOR_KEY) {
      throw new ForbiddenException({
        message: '«Директор» — системная роль с полными правами, её нельзя изменить',
      });
    }

    // Ветка 3 — правка ГЛОБАЛЬНОЙ системной роли (master/admin) через copy-on-write.
    if (existing.tenant_id === null) {
      if (!existing.is_system || !systemKey) {
        // Глобальной несистемной строки быть не должно — fail-closed.
        throw new ForbiddenException({ message: 'Системную роль нельзя изменить — создайте копию' });
      }
      // Уже материализован? Правим существующий override (мерж). Иначе создаём.
      const { rows: ov } = await this.pool.query(
        `SELECT ${SELECT_COLUMNS} FROM roles WHERE tenant_id = $1 AND system_key = $2`,
        [tenantID, systemKey],
      );
      if (ov.length > 0) return this.writeOwnRole(ov[0], tenantID, patch, true);
      return this.materializeSystemOverride(existing, tenantID, patch, systemKey);
    }

    // Ветки 1–2 — правка СВОЕЙ тенантной строки. override (is_system && system_key)
    // → мерж; кастомная → замена (как раньше).
    const isOverride = existing.is_system && !!systemKey;
    return this.writeOwnRole(existing, tenantID, patch, isOverride);
  }

  /**
   * Записать СВОЮ (тенантную) роль: кастомную или override. `mergeMatrix`:
   *   • false — matrix из патча ЗАМЕНЯЕТ сохранённую (кастомная роль);
   *   • true  — matrix из патча МЕРЖИТСЯ поверх сохранённой (override — держим
   *             полную матрицу, частичный патч не обнуляет соседние ячейки).
   * Всё строго `WHERE tenant_id` — чужую строку тронуть нельзя (плюс RLS).
   */
  private async writeOwnRole(
    existing: { id: string; matrix: unknown },
    tenantID: string,
    patch: { name?: string; description?: string; matrix?: Record<string, Record<string, unknown>>; sort?: number },
    mergeMatrix: boolean,
  ): Promise<RoleRow> {
    let matrixParam: string | null = null;
    if (patch.matrix !== undefined) {
      const patchMatrix = sanitizeRoleMatrix(patch.matrix);
      matrixParam = JSON.stringify(
        mergeMatrix ? mergeRoleMatrix(sanitizeRoleMatrix(this.parseMatrix(existing.matrix)), patchMatrix) : patchMatrix,
      );
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
          existing.id,
          tenantID,
          patch.name !== undefined ? patch.name.trim() : null,
          patch.description !== undefined ? patch.description.trim() : null,
          matrixParam,
          patch.sort ?? null,
        ],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Роль не найдена' });

      if (patch.matrix !== undefined) {
        // База эффективных прав изменилась у всех, кто на этой роли, — не ждём TTL.
        const { rows: assigned } = await this.pool.query(`SELECT id FROM users WHERE role_id = $1 AND tenant_id = $2`, [
          existing.id,
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
   * Copy-on-write материализация системной роли для тенанта (ITEM 5). В ОДНОЙ
   * транзакции: INSERT тенантного override (system_key = ключ глобала, матрица =
   * матрица глобала ⊕ патч) + перевод пользователей тенанта с глобальной роли на
   * override. Глобальная строка не изменяется (RLS её и не дал бы записать).
   *
   * Гонка параллельной материализации ловится уникальным
   * roles_tenant_system_key_uniq (23505) → ROLLBACK и обновление уже созданного
   * override. Коллизия имени с существующей кастомной ролью тенанта
   * (roles_tenant_name_uniq) → понятная 400.
   */
  private async materializeSystemOverride(
    globalRow: RoleRowRaw,
    tenantID: string,
    patch: { name?: string; description?: string; matrix?: Record<string, Record<string, unknown>>; sort?: number },
    systemKey: RoleSystemKey,
  ): Promise<RoleRow> {
    const baseMatrix = sanitizeRoleMatrix(this.parseMatrix(globalRow.matrix));
    const patchMatrix = patch.matrix !== undefined ? sanitizeRoleMatrix(patch.matrix) : {};
    const mergedMatrix = mergeRoleMatrix(baseMatrix, patchMatrix);
    const name = patch.name !== undefined ? patch.name.trim() : globalRow.name;
    const description = patch.description !== undefined ? patch.description.trim() : (globalRow.description ?? null);
    const sort = patch.sort ?? (parseInt(String(globalRow.sort), 10) || 0);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let overrideRow: RoleRowRaw;
      try {
        const { rows } = await client.query(
          `INSERT INTO roles (tenant_id, name, description, is_system, matrix, sort, system_key)
           VALUES ($1, $2, $3, true, $4::jsonb, $5, $6)
           RETURNING ${SELECT_COLUMNS}`,
          [tenantID, name, description, JSON.stringify(mergedMatrix), sort, systemKey],
        );
        overrideRow = rows[0];
      } catch (err: unknown) {
        const e = err as { code?: string; constraint?: string };
        if (e.code === '23505' && e.constraint === 'roles_tenant_system_key_uniq') {
          // Проиграли гонку — override уже создан другим запросом. Обновляем его.
          await client.query('ROLLBACK');
          const { rows: ov } = await this.pool.query(
            `SELECT ${SELECT_COLUMNS} FROM roles WHERE tenant_id = $1 AND system_key = $2`,
            [tenantID, systemKey],
          );
          if (ov.length === 0) throw new NotFoundException({ message: 'Роль не найдена' });
          return this.writeOwnRole(ov[0], tenantID, patch, true);
        }
        if (e.code === '23505' && e.constraint === 'roles_tenant_name_uniq') {
          await client.query('ROLLBACK');
          throw new BadRequestException({
            message: `У вас уже есть роль с именем «${name}». Переименуйте её, чтобы настроить системную роль «${globalRow.name}».`,
          });
        }
        throw err;
      }

      // Переводим пользователей ЭТОГО тенанта с глобальной роли на override.
      const { rows: assigned } = await client.query(
        `UPDATE users SET role_id = $1 WHERE role_id = $2 AND tenant_id = $3 RETURNING id`,
        [overrideRow.id, globalRow.id, tenantID],
      );
      await client.query('COMMIT');
      for (const u of assigned) invalidateAuthUser(u.id);
      return this.toRow(overrideRow);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* соединение уже мертво — release ниже его уничтожит */
      }
      throw err;
    } finally {
      client.release();
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
