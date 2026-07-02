import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

/**
 * Check templates — personal since migration 110.
 *
 * Visibility: an actor sees templates of their tenant WHERE user_id IS NULL
 * (общий / legacy template, visible to everyone) OR user_id = actor. Personal
 * templates of OTHER users are invisible — including to owner-class roles.
 *
 * Ownership:
 *   • personal template (user_id = actor) — full CRUD by its author, any role;
 *   • общий template (user_id IS NULL) — update/delete by owner-class only;
 *   • shared=true on create — owner-class only; everyone else always creates
 *     a personal template.
 *
 * Folders (check_template_folders) are strictly PERSONAL (user_id NOT NULL):
 * every employee manages their own tree. Общие templates stay folder-less.
 */
const OWNER_CLASS_ROLES = new Set(['superadmin', 'director', 'admin']);

export interface TemplateActor {
  userID: string;
  role: string;
}

function isOwnerClass(actor: TemplateActor): boolean {
  return !!actor.role && OWNER_CLASS_ROLES.has(actor.role);
}

const TEMPLATE_COLS = 'id, name, services, products, user_id, folder_id, created_at, updated_at';
const FOLDER_COLS = 'id, name, parent_id, sort, created_at';

@Injectable()
export class CheckTemplatesService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapRow(r: any) {
    return {
      id: r.id,
      name: r.name,
      services: r.services || [],
      products: r.products || [],
      userId: r.user_id ?? null,
      folderId: r.folder_id ?? null,
      isShared: r.user_id == null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapFolder(r: any) {
    return {
      id: r.id,
      name: r.name,
      parentId: r.parent_id ?? null,
      sort: r.sort ?? 0,
      createdAt: r.created_at,
    };
  }

  /** Folder must exist, belong to the actor and the tenant. */
  private async assertOwnFolder(folderId: string, tenantId: string, userId: string) {
    const { rows } = await this.pool.query(
      `SELECT id FROM check_template_folders WHERE id=$1 AND tenant_id=$2 AND user_id=$3`,
      [folderId, tenantId, userId],
    );
    if (rows.length === 0) throw new BadRequestException({ message: 'Папка не найдена' });
  }

  // ── Templates ────────────────────────────────────────────────────────────

  async getAll(tenantId: string, userId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${TEMPLATE_COLS}
       FROM check_templates
       WHERE tenant_id=$1 AND (user_id IS NULL OR user_id=$2)
       ORDER BY name ASC`,
      [tenantId, userId],
    );
    return rows.map(this.mapRow);
  }

  async create(
    tenantId: string,
    actor: TemplateActor,
    dto: { name: string; services: any[]; products: any[]; folderId?: string | null; shared?: boolean },
  ) {
    // Only owner-class may publish an общий template; everyone else always
    // creates a personal one (shared flag is ignored for them by design).
    const ownerId = dto.shared === true && isOwnerClass(actor) ? null : actor.userID;

    let folderId: string | null = null;
    if (dto.folderId != null) {
      if (ownerId === null) {
        throw new BadRequestException({ message: 'Общий шаблон нельзя поместить в личную папку' });
      }
      await this.assertOwnFolder(dto.folderId, tenantId, actor.userID);
      folderId = dto.folderId;
    }

    const { rows } = await this.pool.query(
      `INSERT INTO check_templates (tenant_id, name, services, products, user_id, folder_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${TEMPLATE_COLS}`,
      [tenantId, dto.name, JSON.stringify(dto.services || []), JSON.stringify(dto.products || []), ownerId, folderId],
    );
    return this.mapRow(rows[0]);
  }

  /**
   * Loads a template the actor is allowed to MODIFY. Personal templates of
   * other users come back as 404 (they are invisible, do not leak existence);
   * общие templates are modifiable by owner-class only → 403 otherwise.
   */
  private async loadForWrite(id: string, tenantId: string, actor: TemplateActor) {
    const { rows } = await this.pool.query(
      `SELECT ${TEMPLATE_COLS} FROM check_templates
       WHERE id=$1 AND tenant_id=$2 AND (user_id IS NULL OR user_id=$3)`,
      [id, tenantId, actor.userID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Шаблон не найден' });
    const row = rows[0];
    if (row.user_id == null && !isOwnerClass(actor)) {
      throw new ForbiddenException({ message: 'Общий шаблон может изменять только руководитель' });
    }
    return row;
  }

  async update(
    id: string,
    tenantId: string,
    actor: TemplateActor,
    dto: { name?: string; services?: any[]; products?: any[]; folderId?: string | null },
  ) {
    const current = await this.loadForWrite(id, tenantId, actor);

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(dto.name);
    }
    if (dto.services !== undefined) {
      sets.push(`services=$${idx++}`);
      vals.push(JSON.stringify(dto.services));
    }
    if (dto.products !== undefined) {
      sets.push(`products=$${idx++}`);
      vals.push(JSON.stringify(dto.products));
    }
    if (dto.folderId !== undefined) {
      if (dto.folderId !== null) {
        if (current.user_id == null) {
          // Общие templates stay folder-less — folders are personal trees.
          throw new BadRequestException({ message: 'Общий шаблон нельзя поместить в личную папку' });
        }
        await this.assertOwnFolder(dto.folderId, tenantId, actor.userID);
      }
      sets.push(`folder_id=$${idx++}`);
      vals.push(dto.folderId);
    }
    sets.push(`updated_at=now()`);

    if (sets.length === 1) {
      // Nothing to change — return current state (loadForWrite already fetched it).
      return this.mapRow(current);
    }

    vals.push(id, tenantId);
    const { rows } = await this.pool.query(
      `UPDATE check_templates SET ${sets.join(', ')}
       WHERE id=$${idx++} AND tenant_id=$${idx}
       RETURNING ${TEMPLATE_COLS}`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Шаблон не найден' });
    return this.mapRow(rows[0]);
  }

  async remove(id: string, tenantId: string, actor: TemplateActor) {
    await this.loadForWrite(id, tenantId, actor);
    const { rows } = await this.pool.query(`DELETE FROM check_templates WHERE id=$1 AND tenant_id=$2 RETURNING id`, [
      id,
      tenantId,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Шаблон не найден' });
    return { message: 'Удалено' };
  }

  // ── Folders (personal trees) ─────────────────────────────────────────────

  async getFolders(tenantId: string, userId: string) {
    const { rows } = await this.pool.query(
      `SELECT ${FOLDER_COLS} FROM check_template_folders
       WHERE tenant_id=$1 AND user_id=$2
       ORDER BY sort ASC, name ASC`,
      [tenantId, userId],
    );
    return rows.map(this.mapFolder);
  }

  async createFolder(tenantId: string, userId: string, dto: { name: string; parentId?: string | null; sort?: number }) {
    const name = typeof dto?.name === 'string' ? dto.name.trim() : '';
    if (!name) throw new BadRequestException({ message: 'Укажите название папки' });

    let parentId: string | null = null;
    if (dto.parentId != null) {
      await this.assertOwnFolder(dto.parentId, tenantId, userId);
      parentId = dto.parentId;
    }
    const sort = Number.isFinite(Number(dto.sort)) ? Math.trunc(Number(dto.sort)) : 0;

    const { rows } = await this.pool.query(
      `INSERT INTO check_template_folders (tenant_id, user_id, name, parent_id, sort)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${FOLDER_COLS}`,
      [tenantId, userId, name, parentId, sort],
    );
    return this.mapFolder(rows[0]);
  }

  /**
   * Cycle guard for moves: the new parent's ancestor chain (parent included)
   * must not contain the folder being moved — otherwise the move would put
   * the folder inside its own descendant. Also validates the parent exists
   * and belongs to the same actor+tenant (anchor of the CTE filters by both).
   */
  private async assertParentAllowed(folderId: string, parentId: string, tenantId: string, userId: string) {
    if (parentId === folderId) {
      throw new BadRequestException({ message: 'Папка не может быть вложена сама в себя' });
    }
    const { rows } = await this.pool.query(
      `WITH RECURSIVE anc AS (
         SELECT id, parent_id FROM check_template_folders
         WHERE id=$1 AND tenant_id=$2 AND user_id=$3
         UNION ALL
         SELECT f.id, f.parent_id FROM check_template_folders f JOIN anc ON f.id = anc.parent_id
       )
       SELECT id FROM anc`,
      [parentId, tenantId, userId],
    );
    if (rows.length === 0) throw new BadRequestException({ message: 'Папка не найдена' });
    if (rows.some((r) => r.id === folderId)) {
      throw new BadRequestException({ message: 'Нельзя переместить папку внутрь её подпапки' });
    }
  }

  async updateFolder(
    id: string,
    tenantId: string,
    userId: string,
    dto: { name?: string; parentId?: string | null; sort?: number },
  ) {
    const { rows: existing } = await this.pool.query(
      `SELECT ${FOLDER_COLS} FROM check_template_folders WHERE id=$1 AND tenant_id=$2 AND user_id=$3`,
      [id, tenantId, userId],
    );
    if (existing.length === 0) throw new NotFoundException({ message: 'Папка не найдена' });

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      const name = typeof dto.name === 'string' ? dto.name.trim() : '';
      if (!name) throw new BadRequestException({ message: 'Укажите название папки' });
      sets.push(`name=$${idx++}`);
      vals.push(name);
    }
    if (dto.parentId !== undefined) {
      if (dto.parentId !== null) {
        await this.assertParentAllowed(id, dto.parentId, tenantId, userId);
      }
      sets.push(`parent_id=$${idx++}`);
      vals.push(dto.parentId);
    }
    if (dto.sort !== undefined) {
      if (!Number.isFinite(Number(dto.sort))) throw new BadRequestException({ message: 'Некорректный порядок' });
      sets.push(`sort=$${idx++}`);
      vals.push(Math.trunc(Number(dto.sort)));
    }

    if (sets.length === 0) return this.mapFolder(existing[0]);

    vals.push(id, tenantId, userId);
    const { rows } = await this.pool.query(
      `UPDATE check_template_folders SET ${sets.join(', ')}
       WHERE id=$${idx++} AND tenant_id=$${idx++} AND user_id=$${idx}
       RETURNING ${FOLDER_COLS}`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Папка не найдена' });
    return this.mapFolder(rows[0]);
  }

  /**
   * Deletes a folder and (via FK cascade) all its subfolders. Templates that
   * lived anywhere in the deleted subtree are NOT deleted — their folder_id
   * is nulled first, all inside one transaction.
   */
  async removeFolder(id: string, tenantId: string, userId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: subtree } = await client.query(
        `WITH RECURSIVE sub AS (
           SELECT id FROM check_template_folders WHERE id=$1 AND tenant_id=$2 AND user_id=$3
           UNION ALL
           SELECT f.id FROM check_template_folders f JOIN sub ON f.parent_id = sub.id
         )
         SELECT id FROM sub`,
        [id, tenantId, userId],
      );
      if (subtree.length === 0) {
        throw new NotFoundException({ message: 'Папка не найдена' });
      }

      const ids = subtree.map((r) => r.id);
      await client.query(`UPDATE check_templates SET folder_id=NULL WHERE tenant_id=$1 AND folder_id = ANY($2)`, [
        tenantId,
        ids,
      ]);
      await client.query(`DELETE FROM check_template_folders WHERE id=$1 AND tenant_id=$2 AND user_id=$3`, [
        id,
        tenantId,
        userId,
      ]);

      await client.query('COMMIT');
      return { message: 'Удалено' };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
