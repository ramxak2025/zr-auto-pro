import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { warehousePointFilterSql } from '../common/point-scope';
import { WarehousesService } from '../warehouses/warehouses.service';
import { CreateStorageCellDto } from './dto/create-storage-cell.dto';
import { BulkCreateStorageCellsDto } from './dto/bulk-create-storage-cells.dto';
import { UpdateStorageCellDto } from './dto/update-storage-cell.dto';
import { MAX_BULK_CELLS, MAX_CELL_CODE_LENGTH, isUuidString, normalizeCellCode } from './storage-cells.helpers';

/** Форма ответа — shared `StorageCell`. */
export interface StorageCellView {
  id: string;
  warehouseId: string;
  code: string;
  name: string | null;
  sortOrder: number;
  productsCount: number;
}

// productsCount — только живые товары (корзина не считается): удалённый в корзину
// товар ячейку не «занимает», а при удалении ячейки его адрес снимается вместе с остальными.
const CELL_SELECT = `SELECT sc.id, sc.warehouse_id, sc.code, sc.name, sc.sort_order,
       (SELECT COUNT(*)::int FROM products p
         WHERE p.storage_cell_id = sc.id AND p.tenant_id = sc.tenant_id AND p.deleted_at IS NULL) AS products_count
  FROM storage_cells sc`;

interface StorageCellRow {
  id: string;
  warehouse_id: string;
  code: string;
  name: string | null;
  sort_order: number | null;
  products_count: number | string | null;
}

function mapCell(row: StorageCellRow): StorageCellView {
  return {
    id: row.id,
    warehouseId: row.warehouse_id,
    code: row.code,
    name: row.name ?? null,
    sortOrder: row.sort_order ?? 0,
    productsCount: Number(row.products_count ?? 0),
  };
}

/** Подпись: trim, пустая строка = без подписи. */
function cleanName(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  return trimmed ? trimmed : null;
}

/** Нормализованный непустой код не длиннее лимита; иначе 400. */
function requireCode(raw: unknown): string {
  const code = normalizeCellCode(raw);
  if (!code) throw new BadRequestException({ message: 'Укажите код ячейки' });
  if (code.length > MAX_CELL_CODE_LENGTH) {
    throw new BadRequestException({ message: `Код ячейки не длиннее ${MAX_CELL_CODE_LENGTH} символов` });
  }
  return code;
}

@Injectable()
export class StorageCellsService {
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private warehouses: WarehousesService,
  ) {}

  /**
   * Склад должен существовать, принадлежать тенанту и ФИЛИАЛУ сессии — тот же гейт,
   * что у товаров (ячейка чужого филиала недоступна). Филиала у самой ячейки нет:
   * он выводится из warehouses.point_id.
   */
  private async assertWarehouse(tenantID: string, warehouseId: unknown, pointId: string | null): Promise<string> {
    if (!isUuidString(warehouseId)) throw new BadRequestException({ message: 'Не указан склад' });
    const wh = await this.warehouses.assertInTenant(tenantID, warehouseId.trim(), pointId);
    return wh.id;
  }

  private async getOne(tenantID: string, id: string, pointId: string | null): Promise<StorageCellView> {
    const params: unknown[] = [id, tenantID];
    const scope = warehousePointFilterSql('sc', pointId, params);
    const { rows } = await this.pool.query(`${CELL_SELECT} WHERE sc.id = $1 AND sc.tenant_id = $2${scope}`, params);
    if (rows.length === 0) throw new NotFoundException({ message: 'Ячейка не найдена' });
    return mapCell(rows[0]);
  }

  /** 23505 на uq_storage_cells_wh_code → 409 с кодом для клиента; всё прочее — как есть. */
  private rethrowDuplicate(err: unknown, code: string): never {
    if ((err as { code?: string } | null)?.code === '23505') {
      throw new ConflictException({
        message: `Ячейка «${code}» уже есть на этом складе`,
        code: 'STORAGE_CELL_EXISTS',
      });
    }
    throw err;
  }

  async list(tenantID: string, warehouseId: string | undefined, pointId: string | null): Promise<StorageCellView[]> {
    const whId = await this.assertWarehouse(tenantID, warehouseId, pointId);
    const { rows } = await this.pool.query(
      `${CELL_SELECT} WHERE sc.tenant_id = $1 AND sc.warehouse_id = $2 ORDER BY sc.sort_order, sc.code`,
      [tenantID, whId],
    );
    return rows.map(mapCell);
  }

  async create(tenantID: string, dto: CreateStorageCellDto, pointId: string | null): Promise<StorageCellView> {
    const warehouseId = await this.assertWarehouse(tenantID, dto.warehouseId, pointId);
    const code = requireCode(dto.code);
    try {
      // Новая ячейка встаёт в конец списка склада. Гонка двух вставок даст равный
      // sort_order — безвредно: порядок добивается кодом.
      const { rows } = await this.pool.query(
        `INSERT INTO storage_cells (tenant_id, warehouse_id, code, name, sort_order)
         VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM storage_cells WHERE warehouse_id = $2), 0))
         RETURNING id, warehouse_id, code, name, sort_order, 0 AS products_count`,
        [tenantID, warehouseId, code, cleanName(dto.name)],
      );
      return mapCell(rows[0]);
    } catch (err) {
      return this.rethrowDuplicate(err, code);
    }
  }

  async bulkCreate(
    tenantID: string,
    dto: BulkCreateStorageCellsDto,
    pointId: string | null,
  ): Promise<{ created: number; skipped: string[] }> {
    const warehouseId = await this.assertWarehouse(tenantID, dto.warehouseId, pointId);
    if (!Array.isArray(dto.codes) || dto.codes.length > MAX_BULK_CELLS) {
      throw new BadRequestException({ message: `Слишком много ячеек за раз: максимум ${MAX_BULK_CELLS}` });
    }

    // Нормализуем, выбрасываем пустые и повторы внутри списка. Порядок первого
    // появления сохраняется. Повторы ищем по точной строке: код уже в верхнем регистре,
    // а lower() базы зависит от локали — регистронезависимость держит индекс склада.
    const codes: string[] = [];
    const seen = new Set<string>();
    for (const raw of dto.codes) {
      const code = normalizeCellCode(raw);
      if (!code || seen.has(code)) continue;
      if (code.length > MAX_CELL_CODE_LENGTH) {
        throw new BadRequestException({
          message: `Код «${code.slice(0, 20)}…» длиннее ${MAX_CELL_CODE_LENGTH} символов`,
        });
      }
      seen.add(code);
      codes.push(code);
    }
    if (codes.length === 0) return { created: 0, skipped: [] };

    // Один оператор = атомарно; ON CONFLICT DO NOTHING отдаёт уже существующие коды
    // (и проигравших гонку) как «пропущенные», а не как ошибку. sort_order идёт
    // следом за последней ячейкой склада в порядке списка клиента.
    const { rows } = await this.pool.query(
      `INSERT INTO storage_cells (tenant_id, warehouse_id, code, sort_order)
       SELECT $1::uuid, $2::uuid, u.code,
              COALESCE((SELECT MAX(sort_order) FROM storage_cells WHERE warehouse_id = $2::uuid), -1) + u.pos
         FROM unnest($3::text[]) WITH ORDINALITY AS u(code, pos)
       ON CONFLICT DO NOTHING
       RETURNING code`,
      [tenantID, warehouseId, codes],
    );
    const inserted = new Set<string>(rows.map((r) => r.code as string));
    return { created: inserted.size, skipped: codes.filter((c) => !inserted.has(c)) };
  }

  async update(
    tenantID: string,
    id: string,
    dto: UpdateStorageCellDto,
    pointId: string | null,
  ): Promise<StorageCellView> {
    const current = await this.getOne(tenantID, id, pointId);

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    let code = current.code;
    if (dto.code !== undefined && dto.code !== null) {
      code = requireCode(dto.code);
      if (code !== current.code) {
        sets.push(`code = $${idx++}`);
        vals.push(code);
      }
    }
    if (dto.name !== undefined) {
      sets.push(`name = $${idx++}`);
      vals.push(cleanName(dto.name));
    }
    if (dto.sortOrder !== undefined && dto.sortOrder !== null) {
      sets.push(`sort_order = $${idx++}`);
      vals.push(dto.sortOrder);
    }
    if (sets.length === 0) return current;

    vals.push(id, tenantID);
    try {
      await this.pool.query(
        `UPDATE storage_cells SET ${sets.join(', ')} WHERE id = $${idx++} AND tenant_id = $${idx}`,
        vals,
      );
    } catch (err) {
      return this.rethrowDuplicate(err, code);
    }
    return this.getOne(tenantID, id, pointId);
  }

  /**
   * Порядок ячеек одним оператором (а не циклом UPDATE, как у папок: ячеек на складе
   * бывают тысячи). Чужие / несуществующие id молча пропускаются — так же, как у папок.
   */
  async updateOrder(tenantID: string, orderedIds: string[], pointId: string | null): Promise<{ message: string }> {
    const ids = [...new Set((orderedIds ?? []).filter(isUuidString).map((v) => v.trim()))];
    if (ids.length === 0) return { message: 'OK' };
    const params: unknown[] = [ids, tenantID];
    const scope = warehousePointFilterSql('storage_cells', pointId, params);
    await this.pool.query(
      `UPDATE storage_cells SET sort_order = v.pos - 1
         FROM unnest($1::uuid[]) WITH ORDINALITY AS v(id, pos)
        WHERE storage_cells.id = v.id AND storage_cells.tenant_id = $2${scope}`,
      params,
    );
    return { message: 'OK' };
  }

  /**
   * Физическое удаление (ячейка — справочник, deleted_at не нужен). Пустую ячейку
   * удаляем сразу; с товарами — только с `moveTo` (ячейка ТОГО ЖЕ склада) или
   * `detach`, иначе 409 STORAGE_CELL_NOT_EMPTY. Всё в одной транзакции: строки ячеек
   * заблокированы, поэтому параллельное «положить товар сюда» не проскочит между
   * подсчётом и удалением.
   */
  async remove(
    tenantID: string,
    id: string,
    opts: { moveTo?: string; detach?: boolean },
    pointId: string | null,
  ): Promise<{ ok: true }> {
    // Регистр uuid из URL/query ни на что не влияет, но сравнения ниже — строковые: приводим к виду из БД.
    const cellId = id.toLowerCase();
    const moveTo = typeof opts.moveTo === 'string' && opts.moveTo.trim() ? opts.moveTo.trim().toLowerCase() : undefined;
    const detach = opts.detach === true;
    if (moveTo && detach) {
      throw new BadRequestException({
        message: 'Укажите что-то одно: перенос товаров в другую ячейку или снятие адреса',
      });
    }
    const cell = await this.getOne(tenantID, cellId, pointId);

    if (moveTo) {
      if (!isUuidString(moveTo)) throw new BadRequestException({ message: 'Некорректная ячейка для переноса' });
      if (moveTo === cellId) throw new BadRequestException({ message: 'Нельзя перенести товары в удаляемую ячейку' });
      const { rows } = await this.pool.query(
        'SELECT warehouse_id FROM storage_cells WHERE id = $1 AND tenant_id = $2',
        [moveTo, tenantID],
      );
      if (rows.length === 0 || rows[0].warehouse_id !== cell.warehouseId) {
        throw new BadRequestException({
          message: 'Ячейка для переноса должна быть на том же складе',
          code: 'STORAGE_CELL_WRONG_WAREHOUSE',
        });
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Оба id блокируем одним запросом в порядке id: два встречных удаления
      // (A→B и B→A) не уйдут в deadlock.
      const { rows: locked } = await client.query(
        'SELECT id FROM storage_cells WHERE id = ANY($1::uuid[]) AND tenant_id = $2 ORDER BY id FOR UPDATE',
        [moveTo ? [cellId, moveTo] : [cellId], tenantID],
      );
      const have = new Set<string>(locked.map((r) => r.id as string));
      if (!have.has(cellId)) throw new NotFoundException({ message: 'Ячейка не найдена' });
      if (moveTo && !have.has(moveTo)) {
        throw new BadRequestException({
          message: 'Ячейка для переноса должна быть на том же складе',
          code: 'STORAGE_CELL_WRONG_WAREHOUSE',
        });
      }

      const { rows: cnt } = await client.query(
        'SELECT COUNT(*)::int AS n FROM products WHERE storage_cell_id = $1 AND tenant_id = $2 AND deleted_at IS NULL',
        [cellId, tenantID],
      );
      const productsCount: number = cnt[0].n;
      if (productsCount > 0 && !moveTo && !detach) {
        throw new ConflictException({
          message: `В ячейке «${cell.code}» лежит товаров: ${productsCount}. Перенесите их в другую ячейку или снимите адрес`,
          code: 'STORAGE_CELL_NOT_EMPTY',
          productsCount,
        });
      }

      // Все строки ячейки, включая товары из корзины: восстановление не должно
      // вернуть их в уже удалённую ячейку. FK ON DELETE SET NULL — только страховка.
      await client.query('UPDATE products SET storage_cell_id = $1 WHERE storage_cell_id = $2 AND tenant_id = $3', [
        moveTo ?? null,
        cellId,
        tenantID,
      ]);
      await client.query('DELETE FROM storage_cells WHERE id = $1 AND tenant_id = $2', [cellId, tenantID]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    return { ok: true };
  }
}
