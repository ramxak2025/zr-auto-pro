import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { userHasPermission } from '../common/guards/permissions.guard';
import { CreateCheckTemplateDto, UpdateCheckTemplateDto, normalizeTemplateServices } from './dto/check-template.dto';

export interface TemplateActor {
  userID: string;
  role: string;
  permissions?: Record<string, boolean>;
}

const TEMPLATE_COLS = 'id, name, services, products, user_id, folder_id, created_at, updated_at';
const FOLDER_COLS = 'id, name, parent_id, sort, created_at, user_id';

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
      isShared: r.user_id == null,
      createdAt: r.created_at,
    };
  }

  private requireSharedPermission(actor: TemplateActor) {
    if (!userHasPermission(actor, 'templates_shared_manage')) {
      throw new ForbiddenException({ message: 'Недостаточно прав для управления общими шаблонами и папками' });
    }
  }

  private async withTreeLock<T>(tenantId: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query("SELECT pg_advisory_xact_lock(hashtext('check-template-tree'), hashtext($1))", [tenantId]);
      const result = await work(client);
      await client.query('COMMIT');
      transactionOpen = false;
      return result;
    } catch (error) {
      if (transactionOpen) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the operation error; rollback can fail only after a broken connection.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  private scopeOwner(actor: TemplateActor, shared: boolean): string | null {
    return shared ? null : actor.userID;
  }

  private async assertFolderScope(
    client: PoolClient,
    folderId: string,
    tenantId: string,
    actor: TemplateActor,
    shared: boolean,
  ) {
    const ownerId = this.scopeOwner(actor, shared);
    const { rows } = await client.query(
      `SELECT id FROM check_template_folders
        WHERE id=$1 AND tenant_id=$2 AND user_id IS NOT DISTINCT FROM $3::uuid`,
      [folderId, tenantId, ownerId],
    );
    if (rows.length === 0) {
      throw new BadRequestException({ message: shared ? 'Общая папка не найдена' : 'Личная папка не найдена' });
    }
  }

  private async findVisibleFolder(client: PoolClient, id: string, tenantId: string, actor: TemplateActor) {
    const { rows } = await client.query(
      `SELECT ${FOLDER_COLS} FROM check_template_folders
        WHERE id=$1 AND tenant_id=$2 AND (user_id IS NULL OR user_id=$3)`,
      [id, tenantId, actor.userID],
    );
    if (!rows[0]) throw new NotFoundException({ message: 'Папка не найдена' });
    return rows[0];
  }

  private async assertParentAllowed(
    client: PoolClient,
    folderId: string | null,
    parentId: string,
    tenantId: string,
    actor: TemplateActor,
    shared: boolean,
  ) {
    await this.assertFolderScope(client, parentId, tenantId, actor, shared);
    if (!folderId) return;
    const currentOwner = await client.query<{ user_id: string | null }>(
      'SELECT user_id FROM check_template_folders WHERE id=$1 AND tenant_id=$2',
      [folderId, tenantId],
    );
    if (!currentOwner.rows[0]) throw new NotFoundException({ message: 'Папка не найдена' });
    const { rows: descendants } = await client.query(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM check_template_folders
          WHERE id=$1 AND tenant_id=$2 AND user_id IS NOT DISTINCT FROM $4::uuid
         UNION
         SELECT f.id FROM check_template_folders f JOIN subtree s ON f.parent_id=s.id
          WHERE f.tenant_id=$2 AND f.user_id IS NOT DISTINCT FROM $4::uuid
       )
       SELECT id FROM subtree WHERE id=$3 LIMIT 1`,
      [folderId, tenantId, parentId, currentOwner.rows[0].user_id],
    );
    if (descendants.length > 0) {
      throw new BadRequestException({ message: 'Нельзя переместить папку внутрь её подпапки' });
    }
  }

  private async getScopedSubtree(client: PoolClient, folderId: string, tenantId: string, ownerId: string | null) {
    const { rows } = await client.query<{ id: string }>(
      `WITH RECURSIVE subtree AS (
         SELECT id FROM check_template_folders
          WHERE id=$1 AND tenant_id=$2 AND user_id IS NOT DISTINCT FROM $3::uuid
         UNION
         SELECT f.id FROM check_template_folders f JOIN subtree s ON f.parent_id=s.id
          WHERE f.tenant_id=$2 AND f.user_id IS NOT DISTINCT FROM $3::uuid
       )
       SELECT id FROM subtree`,
      [folderId, tenantId, ownerId],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Папка не найдена' });
    const ids = rows.map((row) => row.id);

    // Refuse a corrupted mixed-scope subtree before an UPDATE or FK cascade can
    // move/delete records outside the root's private/shared scope.
    const mixedFolders = await client.query(
      `SELECT id FROM check_template_folders
        WHERE tenant_id=$1 AND parent_id=ANY($2::uuid[]) AND user_id IS DISTINCT FROM $3::uuid LIMIT 1`,
      [tenantId, ids, ownerId],
    );
    if (mixedFolders.rows.length > 0) {
      throw new BadRequestException({ message: 'В дереве обнаружены папки другого типа доступа' });
    }
    const mixedTemplates = await client.query(
      `SELECT id FROM check_templates
        WHERE tenant_id=$1 AND folder_id=ANY($2::uuid[]) AND user_id IS DISTINCT FROM $3::uuid LIMIT 1`,
      [tenantId, ids, ownerId],
    );
    if (mixedTemplates.rows.length > 0) {
      throw new BadRequestException({ message: 'В папке обнаружены шаблоны другого типа доступа' });
    }
    return ids;
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

  async create(tenantId: string, actor: TemplateActor, dto: CreateCheckTemplateDto) {
    return this.withTreeLock(tenantId, async (client) => {
      const shared = dto.shared === true;
      if (shared) this.requireSharedPermission(actor);
      const ownerId = this.scopeOwner(actor, shared);
      let folderId: string | null = null;
      if (dto.folderId != null) {
        await this.assertFolderScope(client, dto.folderId, tenantId, actor, shared);
        folderId = dto.folderId;
      }
      const { rows } = await client.query(
        `INSERT INTO check_templates (tenant_id, name, services, products, user_id, folder_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${TEMPLATE_COLS}`,
        [
          tenantId,
          dto.name.trim(),
          JSON.stringify(normalizeTemplateServices(dto.services)),
          JSON.stringify(dto.products || []),
          ownerId,
          folderId,
        ],
      );
      return this.mapRow(rows[0]);
    });
  }

  private async loadForWrite(client: PoolClient, id: string, tenantId: string, actor: TemplateActor) {
    const { rows } = await client.query(
      `SELECT ${TEMPLATE_COLS} FROM check_templates
       WHERE id=$1 AND tenant_id=$2 AND (user_id IS NULL OR user_id=$3)`,
      [id, tenantId, actor.userID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Шаблон не найден' });
    if (rows[0].user_id == null) this.requireSharedPermission(actor);
    return rows[0];
  }

  async update(id: string, tenantId: string, actor: TemplateActor, dto: UpdateCheckTemplateDto) {
    return this.withTreeLock(tenantId, async (client) => {
      const current = await this.loadForWrite(client, id, tenantId, actor);
      const currentlyShared = current.user_id == null;
      if (currentlyShared && dto.shared === false) {
        throw new BadRequestException({
          message: 'Нельзя сделать общий шаблон личным: скопируйте его вручную в личный шаблон',
        });
      }
      const shared = currentlyShared || dto.shared === true;
      if (dto.shared === true && !currentlyShared) this.requireSharedPermission(actor);
      let folderId: string | null = current.folder_id ?? null;
      if (dto.folderId !== undefined) folderId = dto.folderId;
      else if (shared && !currentlyShared) folderId = null;
      if (folderId) await this.assertFolderScope(client, folderId, tenantId, actor, shared);

      const sets: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;
      if (dto.name !== undefined) {
        sets.push(`name=$${idx++}`);
        vals.push(dto.name.trim());
      }
      if (dto.services !== undefined) {
        sets.push(`services=$${idx++}`);
        vals.push(JSON.stringify(normalizeTemplateServices(dto.services)));
      }
      if (dto.products !== undefined) {
        sets.push(`products=$${idx++}`);
        vals.push(JSON.stringify(dto.products));
      }
      if (current.user_id !== this.scopeOwner(actor, shared)) {
        sets.push(`user_id=$${idx++}`);
        vals.push(this.scopeOwner(actor, shared));
      }
      if ((current.folder_id ?? null) !== folderId) {
        sets.push(`folder_id=$${idx++}`);
        vals.push(folderId);
      }
      if (sets.length === 0) return this.mapRow(current);
      sets.push('updated_at=now()');
      vals.push(id, tenantId);
      const { rows } = await client.query(
        `UPDATE check_templates SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING ${TEMPLATE_COLS}`,
        vals,
      );
      if (!rows[0]) throw new NotFoundException({ message: 'Шаблон не найден' });
      return this.mapRow(rows[0]);
    });
  }

  async remove(id: string, tenantId: string, actor: TemplateActor) {
    return this.withTreeLock(tenantId, async (client) => {
      await this.loadForWrite(client, id, tenantId, actor);
      const { rows } = await client.query(`DELETE FROM check_templates WHERE id=$1 AND tenant_id=$2 RETURNING id`, [
        id,
        tenantId,
      ]);
      if (rows.length === 0) throw new NotFoundException({ message: 'Шаблон не найден' });
      return { message: 'Удалено' };
    });
  }

  // ── Folders ─────────────────────────────────────────────────────────────

  async getFolders(tenantId: string, actor: TemplateActor) {
    const { rows } = await this.pool.query(
      `SELECT ${FOLDER_COLS} FROM check_template_folders
       WHERE tenant_id=$1 AND (user_id IS NULL OR user_id=$2)
       ORDER BY (user_id IS NOT NULL) ASC, sort ASC, name ASC`,
      [tenantId, actor.userID],
    );
    return rows.map(this.mapFolder);
  }

  async createFolder(
    tenantId: string,
    actor: TemplateActor,
    dto: { name: string; parentId?: string | null; sort?: number; isShared?: boolean },
  ) {
    return this.withTreeLock(tenantId, async (client) => {
      const name = typeof dto?.name === 'string' ? dto.name.trim() : '';
      if (!name || name.length > 200)
        throw new BadRequestException({ message: 'Укажите название папки (до 200 символов)' });
      const shared = dto.isShared === true;
      if (shared) this.requireSharedPermission(actor);
      const ownerId = this.scopeOwner(actor, shared);
      const parentId = dto.parentId ?? null;
      if (parentId) await this.assertFolderScope(client, parentId, tenantId, actor, shared);
      const sort = Number.isFinite(Number(dto.sort)) ? Math.trunc(Number(dto.sort)) : 0;
      const { rows } = await client.query(
        `INSERT INTO check_template_folders (tenant_id, user_id, name, parent_id, sort)
         VALUES ($1, $2, $3, $4, $5) RETURNING ${FOLDER_COLS}`,
        [tenantId, ownerId, name, parentId, sort],
      );
      return this.mapFolder(rows[0]);
    });
  }

  async updateFolder(
    id: string,
    tenantId: string,
    actor: TemplateActor,
    dto: { name?: string; parentId?: string | null; sort?: number; isShared?: boolean },
  ) {
    return this.withTreeLock(tenantId, async (client) => {
      const current = await this.findVisibleFolder(client, id, tenantId, actor);
      const currentlyShared = current.user_id == null;
      if (currentlyShared) this.requireSharedPermission(actor);
      if (currentlyShared && dto.isShared === false) {
        throw new BadRequestException({
          message: 'Нельзя сделать общую папку личной: скопируйте её содержимое вручную',
        });
      }
      const shared = currentlyShared || dto.isShared === true;
      if (dto.isShared === true && !currentlyShared) this.requireSharedPermission(actor);
      const oldOwnerId = current.user_id ?? null;
      const newOwnerId = this.scopeOwner(actor, shared);
      const publishing = !currentlyShared && shared;
      const subtreeIds = publishing ? await this.getScopedSubtree(client, id, tenantId, oldOwnerId) : [id];

      let parentId: string | null = current.parent_id ?? null;
      if (dto.parentId !== undefined) parentId = dto.parentId;
      else if (publishing) parentId = null;
      if (parentId) {
        await this.assertFolderScope(client, parentId, tenantId, actor, shared);
        if (!publishing) await this.assertParentAllowed(client, id, parentId, tenantId, actor, shared);
      }
      const name = dto.name === undefined ? current.name : typeof dto.name === 'string' ? dto.name.trim() : '';
      if (typeof name !== 'string' || !name || name.length > 200) {
        throw new BadRequestException({ message: 'Укажите название папки (до 200 символов)' });
      }
      const sort = dto.sort === undefined ? current.sort : Number(dto.sort);
      if (!Number.isFinite(Number(sort))) throw new BadRequestException({ message: 'Некорректный порядок' });

      if (publishing) {
        await client.query(
          `UPDATE check_template_folders SET user_id=NULL WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND user_id=$3`,
          [tenantId, subtreeIds, actor.userID],
        );
        await client.query(
          `UPDATE check_templates SET user_id=NULL, updated_at=now()
            WHERE tenant_id=$1 AND folder_id=ANY($2::uuid[]) AND user_id=$3`,
          [tenantId, subtreeIds, actor.userID],
        );
      }

      const { rows } = await client.query(
        `UPDATE check_template_folders SET name=$1, parent_id=$2, sort=$3, user_id=$4
          WHERE id=$5 AND tenant_id=$6 AND user_id IS NOT DISTINCT FROM $7::uuid
          RETURNING ${FOLDER_COLS}`,
        [name, parentId, Math.trunc(Number(sort)), newOwnerId, id, tenantId, publishing ? null : oldOwnerId],
      );
      if (!rows[0]) throw new NotFoundException({ message: 'Папка не найдена' });
      return this.mapFolder(rows[0]);
    });
  }

  async removeFolder(id: string, tenantId: string, actor: TemplateActor) {
    return this.withTreeLock(tenantId, async (client) => {
      const folder = await this.findVisibleFolder(client, id, tenantId, actor);
      const ownerId = folder.user_id ?? null;
      if (ownerId === null) this.requireSharedPermission(actor);
      const ids = await this.getScopedSubtree(client, id, tenantId, ownerId);
      await client.query(
        `UPDATE check_templates SET folder_id=NULL, updated_at=now()
          WHERE tenant_id=$1 AND folder_id=ANY($2::uuid[]) AND user_id IS NOT DISTINCT FROM $3::uuid`,
        [tenantId, ids, ownerId],
      );
      for (const folderId of ids.reverse()) {
        await client.query(
          `DELETE FROM check_template_folders
            WHERE id=$1 AND tenant_id=$2 AND user_id IS NOT DISTINCT FROM $3::uuid`,
          [folderId, tenantId, ownerId],
        );
      }
      return { message: 'Удалено' };
    });
  }
}
