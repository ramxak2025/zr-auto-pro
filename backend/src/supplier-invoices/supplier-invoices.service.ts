import { InvoiceOcrProvider } from './invoice-ocr.provider';
import { normalizeInvoiceUnit } from './invoice-units';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { Readable } from 'stream';
import * as fs from 'fs/promises';
import sharp = require('sharp');
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { assertInventoryFeature } from '../common/inventory-features';
import { userHasPermission } from '../common/guards/permissions.guard';
import { actorPointId, warehousePointFilterSql } from '../common/point-scope';
import { LocalStorageAdapter } from '../uploads/storage.service';
import { SuppliersService } from '../suppliers/suppliers.service';
import { InvoiceResult, invoiceAliasKey, normalizeAlias, parseInvoiceTables } from './invoice-parser';
import { ConfirmInvoiceDto, MapInvoiceLineDto } from './supplier-invoices.dto';

interface DocumentRow {
  id: string;
  supplier_id: string;
  point_id: string | null;
  version: number;
  status: string;
  result: InvoiceResult;
  delivery_id: string | null;
  attempts: number;
  processing_at: Date | null;
  duplicate_of: string | null;
  last_error_code: string | null;
  purchase_order_id: string | null;
  document_date: string | null;
}
interface PageRow {
  id: string;
  page_index: number;
  stored_path: string;
  sha256: string;
  byte_size: number;
}

@Injectable()
export class SupplierInvoicesService {
  private activeExtractions = 0;
  private readonly logger = new Logger('SupplierInvoices');
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly storage: LocalStorageAdapter,
    private readonly ocr: InvoiceOcrProvider,
    private readonly suppliers: SuppliersService,
    private readonly orders: PurchaseOrdersService,
  ) {}

  private assertActor(actor: JwtPayload) {
    assertInventoryFeature(actor.tenantID);
    if (!userHasPermission(actor, 'suppliers_manage'))
      throw new ForbiddenException('Недостаточно прав для приёмки накладной');
  }

  private async document(db: Pool | PoolClient, id: string, actor: JwtPayload, lock = false): Promise<DocumentRow> {
    this.assertActor(actor);
    const { rows } = await db.query(
      `SELECT id,supplier_id,point_id,version,status,result,delivery_id,attempts,processing_at,duplicate_of,last_error_code,purchase_order_id,document_date::text AS document_date
      FROM supplier_invoice_documents WHERE id=$1 AND tenant_id=$2 AND ($3::uuid IS NULL OR point_id=$3)${lock ? ' FOR UPDATE' : ''}`,
      [id, actor.tenantID, actorPointId(actor)],
    );
    if (!rows.length) throw new NotFoundException('Накладная не найдена');
    return rows[0];
  }

  private writable(row: DocumentRow, version?: number) {
    if (row.delivery_id || row.status === 'confirmed' || row.status === 'duplicate')
      throw new ConflictException({
        code: 'INVOICE_ALREADY_RECEIVED',
        message: 'Накладная уже принята или является копией',
      });
    if (version !== undefined && row.version !== version)
      throw new ConflictException({
        code: 'INVOICE_VERSION_CONFLICT',
        message: 'Накладная изменилась. Обновите страницу',
      });
    if (row.status === 'processing' && row.processing_at && Date.now() - new Date(row.processing_at).getTime() < 240000)
      throw new ConflictException('Распознавание уже выполняется');
  }

  async prepare(supplierId: string, actor: JwtPayload, orderId?: string) {
    this.assertActor(actor);
    const supplier = await this.pool.query(
      'SELECT id FROM suppliers WHERE id=$1 AND tenant_id=$2 AND is_system=false',
      [supplierId, actor.tenantID],
    );
    if (!supplier.rows.length) throw new BadRequestException('Поставщик не найден');
    if (orderId) {
      const order = await this.orders.getById(orderId, actor.tenantID, actorPointId(actor));
      if (order.supplierId !== supplierId || order.status === 'cancelled' || order.status === 'received')
        throw new BadRequestException('Выберите открытый заказ этого поставщика');
    }
    const { rows } = await this.pool.query(
      `INSERT INTO supplier_invoice_documents(tenant_id,supplier_id,point_id,created_by,purchase_order_id)
      VALUES($1,$2,$3,$4,$5) RETURNING id`,
      [actor.tenantID, supplierId, actorPointId(actor), actor.userID, orderId ?? null],
    );
    return this.get(rows[0].id, actor);
  }

  async get(id: string, actor: JwtPayload) {
    const row = await this.document(this.pool, id, actor);
    const { rows } = await this.pool.query(
      'SELECT id,page_index FROM supplier_invoice_pages WHERE document_id=$1 AND tenant_id=$2 ORDER BY page_index',
      [id, actor.tenantID],
    );
    return {
      id: row.id,
      supplierId: row.supplier_id,
      version: row.version,
      status: row.status,
      date: row.document_date ?? row.result.date,
      orderId: row.purchase_order_id,
      comparison: await this.compareOrder(row, actor),
      pages: rows.map((page) => ({
        id: page.id,
        index: page.page_index,
        url: `/api/supplier-invoices/${id}/pages/${page.id}`,
      })),
      lines: row.result.lines,
      warnings: row.result.warnings,
      deliveryId: row.delivery_id,
      duplicateOf: row.duplicate_of,
      errorCode: row.last_error_code,
    };
  }

  async addPage(id: string, buffer: Buffer, actor: JwtPayload) {
    this.assertActor(actor);
    if (!buffer.length || buffer.length > 10 * 1024 * 1024)
      throw new HttpException('Размер страницы должен быть не больше 10 МБ', 413);
    let extension: string;
    try {
      const metadata = await sharp(buffer, { limitInputPixels: 20_000_000 }).metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > 20_000_000 ||
        (metadata.pages ?? 1) > 1
      )
        throw new Error();
      extension = ({ jpeg: '.jpg', png: '.png', webp: '.webp', heif: '.heic' } as Record<string, string>)[
        metadata.format ?? ''
      ];
      if (!extension) throw new Error();
      // Decode once before committing any private path (detect truncated/corrupt images).
      await sharp(buffer, { limitInputPixels: 20_000_000 })
        .rotate()
        .resize({ width: 64, height: 64, fit: 'inside' })
        .jpeg()
        .toBuffer();
    } catch {
      throw new BadRequestException('Нужна читаемая фотография JPG, PNG, WebP или HEIC до 20 мегапикселей');
    }
    const hash = createHash('sha256').update(buffer).digest('hex');
    const client = await this.pool.connect();
    let storedPath: string | undefined;
    try {
      await client.query('BEGIN');
      const row = await this.document(client, id, actor, true);
      this.writable(row);
      if (row.status === 'processing') throw new ConflictException('Дождитесь завершения распознавания');
      const pages = await client.query(
        'SELECT sha256,byte_size FROM supplier_invoice_pages WHERE document_id=$1 AND tenant_id=$2',
        [id, actor.tenantID],
      );
      if (pages.rows.some((page) => page.sha256 === hash)) {
        await client.query('COMMIT');
        return this.get(id, actor);
      }
      if (
        pages.rows.length >= 8 ||
        pages.rows.reduce((sum, page) => sum + Number(page.byte_size), 0) + buffer.length > 40 * 1024 * 1024
      )
        throw new HttpException('Не больше 8 страниц и 40 МБ на накладную', 413);
      const saved = await this.storage.savePrivate(Readable.from(buffer), extension, actor.tenantID);
      storedPath = saved.storedPath;
      await client.query(
        `INSERT INTO supplier_invoice_pages(tenant_id,document_id,page_index,stored_path,sha256,byte_size)
        VALUES($1,$2,$3,$4,$5,$6)`,
        [actor.tenantID, id, pages.rows.length, saved.storedPath, hash, saved.size],
      );
      await client.query(
        `UPDATE supplier_invoice_documents SET status='draft',document_hash=NULL,result=$3,attempts=0,processing_at=NULL,last_error_code=NULL,version=version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2`,
        [id, actor.tenantID, JSON.stringify({ date: null, lines: [], warnings: [] })],
      );
      await client.query('COMMIT');
      storedPath = undefined;
      return this.get(id, actor);
    } catch (error) {
      await client.query('ROLLBACK');
      if (storedPath) {
        const path = this.storage.resolve(storedPath);
        if (path) await fs.unlink(path);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async deletePage(id: string, pageId: string, version: number, actor: JwtPayload) {
    const client = await this.pool.connect();
    let removed: string | undefined;
    try {
      await client.query('BEGIN');
      const row = await this.document(client, id, actor, true);
      this.writable(row, version);
      if (row.status === 'processing') throw new ConflictException('Дождитесь завершения распознавания');
      const pages = await client.query(
        'SELECT id,page_index,stored_path FROM supplier_invoice_pages WHERE document_id=$1 AND tenant_id=$2 ORDER BY page_index',
        [id, actor.tenantID],
      );
      const page = pages.rows.find((page) => page.id === pageId);
      if (!page) throw new NotFoundException('Страница не найдена');
      await client.query('DELETE FROM supplier_invoice_pages WHERE id=$1 AND document_id=$2 AND tenant_id=$3', [
        pageId,
        id,
        actor.tenantID,
      ]);
      const remaining = pages.rows.filter((page) => page.id !== pageId);
      for (const [index, page] of remaining.entries())
        if (page.page_index !== index)
          await client.query('UPDATE supplier_invoice_pages SET page_index=$3 WHERE id=$1 AND tenant_id=$2', [
            page.id,
            actor.tenantID,
            index,
          ]);
      await client.query(
        `UPDATE supplier_invoice_documents SET status='draft',document_hash=NULL,result=$3,attempts=0,processing_at=NULL,last_error_code=NULL,version=version+1,updated_at=now()
        WHERE id=$1 AND tenant_id=$2`,
        [id, actor.tenantID, JSON.stringify({ date: null, lines: [], warnings: [] })],
      );
      await client.query('COMMIT');
      removed = page.stored_path;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (removed) {
      const path = this.storage.resolve(removed);
      if (path)
        try {
          await fs.unlink(path);
        } catch (error) {
          // Capability/version deletion already committed; a filesystem orphan stays
          // private and cannot be served. Never undo the user's logical deletion.
          if ((error as { code?: string }).code !== 'ENOENT') this.logger.warn('Private invoice page cleanup deferred');
        }
    }
    return this.get(id, actor);
  }

  async page(id: string, pageId: string, actor: JwtPayload) {
    await this.document(this.pool, id, actor);
    const { rows } = await this.pool.query(
      'SELECT stored_path FROM supplier_invoice_pages WHERE id=$1 AND document_id=$2 AND tenant_id=$3',
      [pageId, id, actor.tenantID],
    );
    const path = rows.length ? this.storage.resolve(rows[0].stored_path) : null;
    if (!path) throw new NotFoundException('Страница не найдена');
    return sharp(path, { limitInputPixels: 20_000_000 })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  async extract(id: string, expectedVersion: number, actor: JwtPayload) {
    this.assertActor(actor);
    const existing = await this.document(this.pool, id, actor);
    this.writable(existing, expectedVersion);
    if (existing.status === 'review') return this.get(id, actor);
    this.ocr.assertConfigured();
    if (this.activeExtractions >= (this.ocr.maxConcurrentDocuments ?? 1))
      throw new HttpException({ code: 'OCR_BUSY', message: 'Распознавание занято. Повторите через минуту' }, 429);
    this.activeExtractions++;
    let reserved = false;
    try {
      const reservation = await this.reserve(id, expectedVersion, actor);
      if (reservation.duplicateId) return this.get(reservation.duplicateId, actor);
      reserved = true;
      const annotations = [];
      for (const page of reservation.pages) {
        const path = this.storage.resolve(page.stored_path);
        if (!path) throw new NotFoundException('Исходная страница не найдена');
        const image = await sharp(path, { limitInputPixels: 20_000_000 })
          .rotate()
          .resize({ width: 3000, height: 3000, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 95 })
          .toBuffer();
        annotations.push(await this.ocr.recognize(image));
      }
      const result = parseInvoiceTables(annotations);
      await this.suggest(result, reservation.supplierId, actor);
      await this.pool.query(
        `UPDATE supplier_invoice_documents SET result=$3,status='review',version=version+1,last_error_code=NULL,updated_at=now()
        WHERE id=$1 AND tenant_id=$2 AND status='processing' AND attempts=$4`,
        [id, actor.tenantID, JSON.stringify(result), reservation.attempt],
      );
      return this.get(id, actor);
    } catch (error) {
      if (reserved) {
        const code =
          error instanceof HttpException && typeof error.getResponse() === 'object'
            ? ((error.getResponse() as { code?: string }).code ?? 'OCR_FAILED')
            : 'OCR_FAILED';
        await this.pool.query(
          `UPDATE supplier_invoice_documents SET status='error',version=version+1,last_error_code=$3,updated_at=now()
          WHERE id=$1 AND tenant_id=$2 AND status='processing'`,
          [id, actor.tenantID, code],
        );
      }
      throw error;
    } finally {
      this.activeExtractions--;
    }
  }

  private async reserve(
    id: string,
    version: number,
    actor: JwtPayload,
  ): Promise<{ pages: PageRow[]; supplierId: string; attempt: number; duplicateId?: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `invoice-ocr-budget:${actor.tenantID}`,
      ]);
      const row = await this.document(client, id, actor, true);
      this.writable(row, version);
      if (row.attempts >= 2)
        throw new HttpException(
          { code: 'OCR_RETRY_LIMIT', message: 'Лимит повторов распознавания исчерпан. Заполните поставку вручную' },
          429,
        );
      const pages = (
        await client.query(
          'SELECT * FROM supplier_invoice_pages WHERE document_id=$1 AND tenant_id=$2 ORDER BY page_index',
          [id, actor.tenantID],
        )
      ).rows as PageRow[];
      if (!pages.length) throw new BadRequestException('Добавьте фотографии накладной');
      const hash = createHash('sha256')
        .update(pages.map((page) => page.sha256).join(':'))
        .digest('hex');
      const duplicate = await client.query(
        'SELECT id,point_id FROM supplier_invoice_documents WHERE tenant_id=$1 AND supplier_id=$2 AND document_hash=$3 AND id<>$4',
        [actor.tenantID, row.supplier_id, hash, id],
      );
      if (duplicate.rows.length) {
        if (duplicate.rows[0].point_id !== row.point_id)
          throw new ConflictException('Эта накладная уже загружена в другом филиале');
        await client.query(
          "UPDATE supplier_invoice_documents SET duplicate_of=$3,status='duplicate',version=version+1 WHERE id=$1 AND tenant_id=$2",
          [id, actor.tenantID, duplicate.rows[0].id],
        );
        await client.query('COMMIT');
        return { pages: [], supplierId: row.supplier_id, attempt: 0, duplicateId: duplicate.rows[0].id };
      }
      const contentAttempts = await client.query(
        `SELECT count(*)::int n FROM supplier_invoice_ocr_attempts a JOIN supplier_invoice_documents d ON d.id=a.document_id AND d.tenant_id=a.tenant_id
        WHERE a.tenant_id=$1 AND d.supplier_id=$2 AND a.content_hash=$3`,
        [actor.tenantID, row.supplier_id, hash],
      );
      if (contentAttempts.rows[0].n >= 2)
        throw new HttpException(
          {
            code: 'OCR_RETRY_LIMIT',
            message: 'Лимит распознавания этих страниц исчерпан. Переснимите страницу или заполните строки вручную',
          },
          429,
        );
      const budget = await client.query(
        `SELECT COALESCE(sum(pages),0)::int month_pages,count(*) FILTER(WHERE created_at>now()-interval '1 minute')::int minute_calls
        FROM supplier_invoice_ocr_attempts WHERE tenant_id=$1 AND created_at>=date_trunc('month',now())`,
        [actor.tenantID],
      );
      const maxPages = Math.max(1, Math.min(3000, Number(process.env.INVOICE_OCR_MONTHLY_PAGE_LIMIT) || 300));
      if (budget.rows[0].month_pages + pages.length > maxPages || budget.rows[0].minute_calls >= 3)
        throw new HttpException(
          {
            code: 'OCR_BUDGET_LIMIT',
            message: 'Достигнут лимит распознавания. Повторите позже или заполните поставку вручную',
          },
          429,
        );
      await client.query(
        'INSERT INTO supplier_invoice_ocr_attempts(tenant_id,document_id,pages,content_hash) VALUES($1,$2,$3,$4)',
        [actor.tenantID, id, pages.length, hash],
      );
      await client.query(
        "UPDATE supplier_invoice_documents SET document_hash=$3,status='processing',processing_at=now(),attempts=attempts+1,version=version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2",
        [id, actor.tenantID, hash],
      );
      await client.query('COMMIT');
      return { pages, supplierId: row.supplier_id, attempt: row.attempts + 1 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async suggest(result: InvoiceResult, supplierId: string, actor: JwtPayload) {
    const params: unknown[] = [actor.tenantID, supplierId, result.lines.map(invoiceAliasKey)];
    const point = warehousePointFilterSql('p', actorPointId(actor), params);
    const aliases = await this.pool.query(
      `SELECT a.alias_key,a.product_id FROM supplier_product_aliases a JOIN products p ON p.id=a.product_id AND p.tenant_id=a.tenant_id
      WHERE a.tenant_id=$1 AND a.supplier_id=$2 AND a.alias_key=ANY($3::text[]) AND p.deleted_at IS NULL AND p.assembly_id IS NULL AND NOT EXISTS(SELECT 1 FROM warehouses wu WHERE wu.id=p.warehouse_id AND wu.kind='used')${point}`,
      params,
    );
    const byKey = new Map(aliases.rows.map((row) => [row.alias_key, row.product_id]));
    const skus = [...new Set(result.lines.map((line) => normalizeAlias(line.sku)).filter(Boolean))];
    const skuParams: unknown[] = [actor.tenantID, supplierId, skus];
    const skuPoint = warehousePointFilterSql('p', actorPointId(actor), skuParams);
    const skuProducts = skus.length
      ? (
          await this.pool.query(
            `SELECT p.id,p.article,p.barcode FROM products p
      WHERE p.tenant_id=$1 AND (p.supplier_id IS NULL OR p.supplier_id=$2) AND p.deleted_at IS NULL AND p.assembly_id IS NULL AND NOT EXISTS(SELECT 1 FROM warehouses wu WHERE wu.id=p.warehouse_id AND wu.kind='used')
      AND (btrim(regexp_replace(replace(lower(COALESCE(p.article,'')),'ё','е'),'[^[:alnum:]]+',' ','g'))=ANY($3::text[])
        OR btrim(regexp_replace(replace(lower(COALESCE(p.barcode,'')),'ё','е'),'[^[:alnum:]]+',' ','g'))=ANY($3::text[]))${skuPoint}`,
            skuParams,
          )
        ).rows
      : [];
    for (const line of result.lines) {
      const alias = byKey.get(invoiceAliasKey(line));
      const sku = normalizeAlias(line.sku);
      const candidates = sku
        ? skuProducts.filter((product) =>
            [product.article, product.barcode].some((value) => normalizeAlias(value ?? '') === sku),
          )
        : [];
      line.suggestedProductId = alias ?? (candidates.length === 1 ? candidates[0].id : null);
    }
  }

  async mapLine(id: string, lineId: string, dto: MapInvoiceLineDto, actor: JwtPayload) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.document(client, id, actor, true);
      this.writable(row, dto.expectedVersion);
      if (row.status !== 'review') throw new ConflictException('Сначала распознайте накладную');
      const line = row.result.lines.find((line) => line.id === lineId);
      if (!line) throw new NotFoundException('Строка не найдена');
      const params: unknown[] = [dto.productId, actor.tenantID];
      const point = warehousePointFilterSql('p', actorPointId(actor), params);
      const product = await client.query(
        `SELECT p.id,p.unit FROM products p WHERE p.id=$1 AND p.tenant_id=$2 AND p.deleted_at IS NULL AND p.assembly_id IS NULL AND NOT EXISTS(SELECT 1 FROM warehouses wu WHERE wu.id=p.warehouse_id AND wu.kind='used')${point}`,
        params,
      );
      if (!product.rows.length) throw new BadRequestException('Товар не найден в текущем филиале');
      line.productId = dto.productId;
      line.productUnit = product.rows[0].unit || 'шт';
      line.unitMismatch =
        !normalizeInvoiceUnit(line.unit) || normalizeInvoiceUnit(line.unit) !== normalizeInvoiceUnit(line.productUnit);
      line.unitConfirmed =
        !line.unitMismatch ||
        (dto.unitConfirmed === true &&
          normalizeInvoiceUnit(dto.productUnit) === normalizeInvoiceUnit(line.productUnit));
      line.warnings = line.warnings.filter((warning) => !warning.startsWith('Единица накладной'));
      if (line.unitMismatch)
        line.warnings.push(
          `Единица накладной «${line.unit || 'не распознана'}», каталог: «${line.productUnit}». Подтвердите количество и закупочную цену в единицах каталога`,
        );
      if (dto.remember !== false)
        await client.query(
          `INSERT INTO supplier_product_aliases(tenant_id,supplier_id,alias_key,product_id,confirmed_by)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,supplier_id,alias_key) DO UPDATE SET product_id=excluded.product_id,confirmed_by=excluded.confirmed_by,updated_at=now()`,
          [actor.tenantID, row.supplier_id, invoiceAliasKey(line), dto.productId, actor.userID],
        );
      await client.query(
        'UPDATE supplier_invoice_documents SET result=$3,version=version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2',
        [id, actor.tenantID, JSON.stringify(row.result)],
      );
      await client.query('COMMIT');
      return this.get(id, actor);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setOrder(id: string, version: number, orderId: string | null, actor: JwtPayload) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.document(client, id, actor, true);
      this.writable(row, version);
      if (orderId) {
        const order = await this.orders.getById(orderId, actor.tenantID, actorPointId(actor));
        if (order.supplierId !== row.supplier_id || order.status === 'cancelled' || order.status === 'received')
          throw new BadRequestException('Выберите открытый заказ этого поставщика');
      }
      await client.query(
        'UPDATE supplier_invoice_documents SET purchase_order_id=$3,version=version+1,updated_at=now() WHERE id=$1 AND tenant_id=$2',
        [id, actor.tenantID, orderId],
      );
      await client.query('COMMIT');
      return this.get(id, actor);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async compareOrder(row: DocumentRow, actor: JwtPayload) {
    if (!row.purchase_order_id) return null;
    const order = await this.orders.getById(row.purchase_order_id, actor.tenantID, actorPointId(actor));
    const items = order.items.map((item) => ({
      orderItemId: item.id,
      productId: item.productId,
      name: item.name,
      orderedQuantity: item.quantity,
      outstandingQuantity: Math.max(0, item.quantity - item.receivedQuantity),
      price: item.costPrice,
    }));
    const matched = new Set<string>();
    const lines = row.result.lines.map((line) => {
      const productId = line.productId ?? line.suggestedProductId;
      const candidates = items.filter((item) => item.productId === productId);
      const selected = candidates.length === 1 ? candidates[0] : null;
      if (selected) matched.add(selected.orderItemId);
      return {
        lineId: line.id,
        orderItemId: selected?.orderItemId ?? null,
        orderedQuantity: selected?.orderedQuantity ?? null,
        outstandingQuantity: selected?.outstandingQuantity ?? null,
        orderedPrice: selected?.price ?? null,
        markers: !candidates.length
          ? ['extra']
          : !selected
            ? ['ambiguous']
            : [
                ...(line.quantity !== selected.outstandingQuantity ? ['different_quantity'] : []),
                ...(line.price !== selected.price ? ['different_price'] : []),
              ],
      };
    });
    return {
      orderId: order.id,
      status: order.status,
      items,
      lines,
      missingOrderItemIds: items
        .filter((item) => item.outstandingQuantity > 0 && !matched.has(item.orderItemId))
        .map((item) => item.orderItemId),
    };
  }

  async confirm(id: string, dto: ConfirmInvoiceDto, actor: JwtPayload) {
    const row = await this.document(this.pool, id, actor);
    if (row.purchase_order_id) {
      if (
        dto.items.some((item) => row.result.lines.find((line) => line.id === item.lineId)?.productId !== item.productId)
      )
        throw new BadRequestException('Подтвердите соответствие каждого товара');
      if (
        dto.items.some((item) => !item.orderItemId) ||
        new Set(dto.items.map((item) => item.orderItemId)).size !== dto.items.length
      ) {
        throw new BadRequestException(
          'Сопоставьте каждую строку с отдельной позицией заказа. Повторные строки объедините явно в заказе или примите накладную без привязки',
        );
      }
      await this.orders.receive(
        row.purchase_order_id,
        actor.tenantID,
        actor.userID,
        {
          requestId: dto.requestId,
          paymentMode: 'debt',
          receivedAt: dto.receivedAt,
          invoiceDocumentId: id,
          invoiceDocumentDate: dto.date,
          expectedInvoiceVersion: dto.expectedVersion,
          invoiceLineIds: dto.items.map((item) => item.lineId),
          invoiceUnits: dto.items.map((item) => ({ unitConfirmed: item.unitConfirmed, productUnit: item.productUnit })),
          items: dto.items.map((item) => ({
            itemId: item.orderItemId!,
            receivedQuantity: item.quantity,
            purchasePrice: item.price,
            sellPrice: item.sellPrice,
          })),
        },
        actorPointId(actor),
      );
      const confirmed = await this.document(this.pool, id, actor);
      if (!confirmed.delivery_id) throw new ConflictException('Приёмка заказа не связана с накладной');
      return { id: confirmed.delivery_id };
    }
    return this.suppliers.createDelivery(
      actor.tenantID,
      {
        supplierId: row.supplier_id,
        date: dto.receivedAt,
        comment: dto.comment,
        requestId: dto.requestId,
        invoiceDocumentId: id,
        invoiceDocumentDate: dto.date,
        expectedInvoiceVersion: dto.expectedVersion,
        invoiceLineIds: dto.items.map((item) => item.lineId),
        invoiceUnits: dto.items.map((item) => ({ unitConfirmed: item.unitConfirmed, productUnit: item.productUnit })),
        items: dto.items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          sellPrice: item.sellPrice,
        })),
      },
      actorPointId(actor),
      actor.userID,
    );
  }
}
