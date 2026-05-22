import { Injectable, Inject, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { LocalStorageAdapter } from '../uploads/storage.service';

@Injectable()
export class CheckPhotosService {
  private readonly logger = new Logger('CheckPhotosService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private storage: LocalStorageAdapter,
  ) {}

  async getByCheck(checkId: string, tenantId: string) {
    // Verify check belongs to tenant
    const { rows: checkRows } = await this.pool.query(`SELECT id FROM checks WHERE id=$1 AND tenant_id=$2`, [
      checkId,
      tenantId,
    ]);
    if (checkRows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });

    const { rows } = await this.pool.query(
      `SELECT cp.id, cp.check_id, cp.photo_url, cp.created_by, cp.created_at,
              u.full_name as created_by_name
       FROM check_photos cp
       LEFT JOIN users u ON u.id = cp.created_by
       WHERE cp.check_id=$1 AND cp.tenant_id=$2
       ORDER BY cp.created_at ASC`,
      [checkId, tenantId],
    );

    return rows.map((r) => ({
      id: r.id,
      checkId: r.check_id,
      photoUrl: r.photo_url,
      createdBy: r.created_by,
      createdByName: r.created_by_name || null,
      createdAt: r.created_at,
    }));
  }

  async create(checkId: string, tenantId: string, userId: string, stream: NodeJS.ReadableStream, ext: string) {
    // Verify check belongs to tenant
    const { rows: checkRows } = await this.pool.query(`SELECT id FROM checks WHERE id=$1 AND tenant_id=$2`, [
      checkId,
      tenantId,
    ]);
    if (checkRows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });

    const stored = await this.storage.save(stream as any, ext, tenantId);

    const { rows } = await this.pool.query(
      `INSERT INTO check_photos (check_id, tenant_id, photo_url, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, check_id, photo_url, created_by, created_at`,
      [checkId, tenantId, stored.url, userId],
    );

    const r = rows[0];
    return {
      id: r.id,
      checkId: r.check_id,
      photoUrl: r.photo_url,
      createdBy: r.created_by,
      createdAt: r.created_at,
    };
  }

  async remove(id: string, tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT cp.id, cp.photo_url FROM check_photos cp
       WHERE cp.id=$1 AND cp.tenant_id=$2`,
      [id, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Фото не найдено' });

    await this.pool.query(`DELETE FROM check_photos WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);

    // Best-effort delete from local storage — the stored path is the relative portion after /api/uploads/
    try {
      const photoUrl: string = rows[0].photo_url;
      const prefix = '/api/uploads/';
      if (photoUrl.startsWith(prefix)) {
        const storedPath = photoUrl.slice(prefix.length);
        const fullPath = this.storage.resolve(storedPath);
        if (fullPath) {
          const fs = await import('fs');
          fs.unlinkSync(fullPath);
          this.logger.log(`Deleted photo file: ${storedPath}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Failed to delete photo file from storage: ${err}`);
    }

    return { message: 'Удалено' };
  }
}
