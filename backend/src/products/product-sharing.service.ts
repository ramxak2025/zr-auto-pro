import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import sharp = require('sharp');
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { assertInventoryFeature } from '../common/inventory-features';
import { actorPointId, warehousePointFilterSql } from '../common/point-scope';
import { LocalStorageAdapter } from '../uploads/storage.service';
import { productPhotos } from './product-photos';

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class ProductSharingService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly storage: LocalStorageAdapter,
  ) {}

  private async assertProduct(id: string, actor: JwtPayload) {
    assertInventoryFeature(actor.tenantID);
    const params: unknown[] = [id, actor.tenantID];
    const point = warehousePointFilterSql('p', actorPointId(actor), params);
    const { rows } = await this.pool.query(
      `SELECT p.id FROM products p WHERE p.id=$1 AND p.tenant_id=$2
      AND p.deleted_at IS NULL${point}`,
      params,
    );
    if (!rows.length) throw new NotFoundException('Товар не найден');
  }

  async create(id: string, actor: JwtPayload) {
    await this.assertProduct(id, actor);
    const token = randomBytes(32).toString('base64url');
    await this.pool.query(
      `INSERT INTO product_share_tokens(token_hash,tenant_id,product_id,created_by)
      VALUES($1,$2,$3,$4)`,
      [tokenHash(token), actor.tenantID, id, actor.userID],
    );
    return { token, path: `/p/${token}` };
  }

  async revoke(id: string, actor: JwtPayload) {
    await this.assertProduct(id, actor);
    await this.pool.query(
      'UPDATE product_share_tokens SET revoked_at=now() WHERE product_id=$1 AND tenant_id=$2 AND revoked_at IS NULL',
      [id, actor.tenantID],
    );
    return { revoked: true };
  }

  private async lookup(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException('Товар не найден');
    // Unauthenticated capability lookup uses the existing public/admin pool routing.
    // No tenant/product identifier or original upload URL leaves this service.
    const { rows } = await this.pool.query(
      `SELECT p.name,p.photos,p.photo,p.sell_price,p.tenant_id
      FROM product_share_tokens t JOIN products p ON p.id=t.product_id AND p.tenant_id=t.tenant_id
      WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND p.deleted_at IS NULL`,
      [tokenHash(token)],
    );
    if (!rows.length) throw new NotFoundException('Товар не найден');
    assertInventoryFeature(rows[0].tenant_id);
    return rows[0];
  }

  /** Accept only an exact path created by our upload adapter in this tenant. */
  private ownedPaths(row: { photos?: unknown; photo?: unknown; tenant_id: string }): string[] {
    return productPhotos(row.photos, row.photo).flatMap((url) => {
      const prefix = `/api/uploads/${row.tenant_id}/`;
      if (!url.startsWith(prefix)) return [];
      const filename = url.slice(prefix.length);
      if (!/^[0-9a-f-]{36}\.(?:jpe?g|png|webp|gif|heic|heif)$/i.test(filename)) return [];
      return [`${row.tenant_id}/${filename}`];
    });
  }

  async getPublic(token: string) {
    const row = await this.lookup(token);
    return {
      name: String(row.name),
      photos: this.ownedPaths(row).map((_, index) => `/api/public/products/${token}/images/${index}`),
      sellPrice: Number(row.sell_price) || 0,
    };
  }

  async image(token: string, index: string): Promise<Buffer> {
    if (!/^[0-3]$/.test(index)) throw new BadRequestException('Фотография не найдена');
    const row = await this.lookup(token);
    const storedPath = this.ownedPaths(row)[Number(index)];
    const fullPath = storedPath ? this.storage.resolve(storedPath) : null;
    if (!fullPath) throw new NotFoundException('Фотография не найдена');
    // Decode and re-encode validated local image data; never fetch a URL or expose
    // original metadata, paths, HTML/SVG, or an arbitrary uploaded file.
    try {
      return await sharp(fullPath, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      throw new NotFoundException('Фотография не найдена');
    }
  }
}
