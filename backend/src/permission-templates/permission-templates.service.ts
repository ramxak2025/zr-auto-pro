import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { UsersService } from '../users/users.service';

/**
 * Shape returned to clients — mirrors `PermissionTemplate` in
 * shared/types/index.ts. `permissions` is the saved blueprint (the SAME shape
 * as users.permissions); applying a template copies this map into a user.
 */
export interface PermissionTemplateRow {
  id: string;
  name: string;
  permissions: Record<string, boolean>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class PermissionTemplatesService {
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    // Reused for the apply path so the self-lockout guard (you can't strip your
    // own user_management) lives in ONE place — UsersService.updatePermissions.
    private readonly usersService: UsersService,
  ) {}

  /** Parse a jsonb value (pg may hand back a string or an already-parsed object). */
  private parsePermissions(raw: unknown): Record<string, boolean> {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, boolean>;
  }

  /** Coerce every value to a strict boolean so a forged non-boolean can't be stored. */
  private cleanPermissions(permissions: Record<string, boolean> | undefined): Record<string, boolean> {
    const clean: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(permissions || {})) {
      clean[key] = value === true;
    }
    return clean;
  }

  private toRow(r: {
    id: string;
    name: string;
    permissions: unknown;
    created_at: string | Date;
    updated_at: string | Date;
  }): PermissionTemplateRow {
    return {
      id: r.id,
      name: r.name,
      permissions: this.parsePermissions(r.permissions),
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : r.updated_at,
    };
  }

  /** List all templates for the tenant, newest name-sorted. */
  async getAll(tenantID: string): Promise<PermissionTemplateRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, name, COALESCE(permissions, '{}') AS permissions, created_at, updated_at
       FROM permission_templates
       WHERE tenant_id = $1
       ORDER BY name ASC, created_at ASC`,
      [tenantID],
    );
    return rows.map((r) => this.toRow(r));
  }

  /** Create a new named template scoped to the tenant. */
  async create(tenantID: string, name: string, permissions: Record<string, boolean>): Promise<PermissionTemplateRow> {
    const clean = this.cleanPermissions(permissions);
    const { rows } = await this.pool.query(
      `INSERT INTO permission_templates (tenant_id, name, permissions)
       VALUES ($1, $2, $3)
       RETURNING id, name, COALESCE(permissions, '{}') AS permissions, created_at, updated_at`,
      [tenantID, name.trim(), JSON.stringify(clean)],
    );
    return this.toRow(rows[0]);
  }

  /**
   * Update a template's name and/or permissions. An omitted field is left
   * unchanged; a provided `permissions` REPLACES the stored map. Tenant-scoped
   * (a foreign id 404s rather than leaking another tenant's template).
   */
  async update(
    id: string,
    tenantID: string,
    patch: { name?: string; permissions?: Record<string, boolean> },
  ): Promise<PermissionTemplateRow> {
    const { rows } = await this.pool.query(
      `UPDATE permission_templates
       SET name = COALESCE($3, name),
           permissions = COALESCE($4, permissions),
           updated_at = now()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, name, COALESCE(permissions, '{}') AS permissions, created_at, updated_at`,
      [
        id,
        tenantID,
        patch.name !== undefined ? patch.name.trim() : null,
        patch.permissions !== undefined ? JSON.stringify(this.cleanPermissions(patch.permissions)) : null,
      ],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Шаблон прав не найден' });
    return this.toRow(rows[0]);
  }

  /** Delete a template (tenant-scoped). Does not affect users it was applied to. */
  async remove(id: string, tenantID: string): Promise<{ success: true }> {
    const { rowCount } = await this.pool.query(`DELETE FROM permission_templates WHERE id = $1 AND tenant_id = $2`, [
      id,
      tenantID,
    ]);
    if (!rowCount) throw new NotFoundException({ message: 'Шаблон прав не найден' });
    return { success: true };
  }

  /**
   * Apply a template to a user: copy the template's permission map into the
   * target user's users.permissions. The actual write goes through
   * UsersService.updatePermissions, so this inherits ALL of its guarantees:
   * tenant-scoped target check, strict-boolean coercion, auth-cache
   * invalidation, and the self-lockout guard (an owner applying a template
   * lacking `user_management` to THEMSELVES is rejected there). Returns the
   * user's resulting permission map.
   */
  async apply(
    templateId: string,
    targetUserId: string,
    tenantID: string,
    actorUserId: string,
  ): Promise<Record<string, boolean>> {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(permissions, '{}') AS permissions
       FROM permission_templates
       WHERE id = $1 AND tenant_id = $2`,
      [templateId, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Шаблон прав не найден' });

    const permissions = this.parsePermissions(rows[0].permissions);
    // Delegate the write (and the self-lockout guard) to UsersService — no
    // duplicated protection here.
    return this.usersService.updatePermissions(targetUserId, tenantID, actorUserId, permissions);
  }
}
