import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { PG_POOL } from '../database.module';
import { ProductsService } from '../products/products.service';
import { ClientsService } from '../clients/clients.service';
import { ChecksService } from '../checks/checks.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { CreateProductDto } from '../products/dto/create-product.dto';
import { UpdateProductDto } from '../products/dto/update-product.dto';
import { CreatePurchaseOrderDto } from '../purchase-orders/dto/create-purchase-order.dto';
import { CreateCheckDto } from '../checks/dto/create-check.dto';
import { AcceptPaymentDto } from '../checks/dto/accept-payment.dto';
import { Connection, EntityType, ImportEvent, Snapshot } from './one-c.types';
import { digest, uuid } from './one-c.rules';

// Only this fixed registry is interpolated into SQL. Neither bridge identifiers
// nor metadata from a 1C database are SQL table/column names.
const PRODUCT_FIELDS = `'name',d.name,'category',d.category,'barcode',d.barcode,'unit',d.unit,'costPrice',d.cost_price,
  'sellPrice',d.sell_price,'minStock',d.min_stock,'warehouseId',d.warehouse_id,'deletedAt',d.deleted_at`;
const CLIENT_FIELDS = `'fullName',d.full_name,'phone',d.phone,'comment',d.comment`;
const CHECK_FIELDS = `'number',d.number,'date',d.date,'masterId',d.master_id,'clientId',d.client_id,
  'carId',d.car_id,'comment',d.comment,'totalRevenue',d.total_revenue,'isDeferred',d.is_deferred,'deletedAt',d.deleted_at,
  'services',COALESCE((SELECT jsonb_agg(jsonb_build_object('serviceId',l.service_id,'masterId',l.master_id,
    'name',l.name,'price',l.price,'quantity',l.quantity) ORDER BY l.id) FROM check_service_lines l WHERE l.check_id=d.id),'[]'::jsonb),
  'products',COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',l.product_id,'name',l.name,
    'sellPrice',l.sell_price,'costPrice',l.cost_price,'quantity',l.quantity) ORDER BY l.id) FROM check_product_lines l WHERE l.check_id=d.id),'[]'::jsonb)`;
const REGISTRY: Record<EntityType, { from: string; scope: string; fields: string }> = {
  products: {
    from: 'products d JOIN warehouses w ON w.id=d.warehouse_id AND w.tenant_id=d.tenant_id',
    scope: 'w.point_id=$2::uuid',
    fields: PRODUCT_FIELDS,
  },
  stock: {
    from: 'products d JOIN warehouses w ON w.id=d.warehouse_id AND w.tenant_id=d.tenant_id',
    scope: 'w.point_id=$2::uuid AND d.deleted_at IS NULL',
    fields: "'productId',d.id,'warehouseId',d.warehouse_id,'quantity',d.stock",
  },
  clients: { from: 'clients d', scope: '(d.point_id=$2::uuid OR d.point_id IS NULL)', fields: CLIENT_FIELDS },
  purchases: {
    from: 'purchase_orders d',
    scope: 'd.point_id=$2::uuid',
    fields: `'supplierId',d.supplier_id,'status',d.status,'note',d.note,'total',d.total,
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('productId',l.product_id,'quantity',l.quantity,
      'costPrice',l.cost_price,'receivedQuantity',l.received_quantity) ORDER BY l.id)
      FROM purchase_order_items l WHERE l.purchase_order_id=d.id AND l.tenant_id=d.tenant_id),'[]'::jsonb)`,
  },
  workOrders: { from: 'checks d', scope: 'd.point_id=$2::uuid', fields: CHECK_FIELDS },
  payments: {
    from: 'checks d',
    scope: 'd.point_id=$2::uuid AND d.is_deferred=false AND d.deleted_at IS NULL',
    fields:
      "'checkId',d.id,'paymentMethod',d.payment_method,'cashAmount',d.cash_amount,'cardAmount',d.card_amount,'totalRevenue',d.total_revenue,'date',d.date",
  },
};

export function snapshotSql(type: EntityType, single = false, lock = false): string {
  const r = REGISTRY[type];
  return `SELECT d.id, jsonb_build_object(${r.fields}) AS payload FROM ${r.from}
    WHERE d.tenant_id=$1::uuid AND ${r.scope}
      AND ${single ? 'd.id=$3::uuid' : '($3::uuid IS NULL OR d.id>$3::uuid)'}
    ORDER BY d.id ${single ? '' : 'LIMIT $4'} ${lock ? 'FOR UPDATE OF d' : ''}`;
}

function only(payload: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(payload).some((key) => !allowed.includes(key)))
    throw new BadRequestException('Есть неподдерживаемые поля; требуется проверка сопоставлений');
  return { ...payload };
}
function requiredText(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new BadRequestException('Проверьте обязательные текстовые поля');
}

@Injectable()
export class OneCDomainService {
  private readonly validator = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private products: ProductsService,
    private clients: ClientsService,
    private purchases: PurchaseOrdersService,
    private checks: ChecksService,
  ) {}

  async snapshots(connection: Connection, type: EntityType, cursor: string | null, limit: number): Promise<Snapshot[]> {
    return (await this.pool.query(snapshotSql(type), [connection.tenant_id, connection.point_id, cursor, limit])).rows;
  }
  async snapshot(
    connection: Connection,
    type: EntityType,
    id: string,
    db: Pick<PoolClient, 'query'> = this.pool,
    lock = false,
  ): Promise<Snapshot> {
    const { rows } = await db.query(snapshotSql(type, true, lock), [
      connection.tenant_id,
      connection.point_id,
      uuid(id),
    ]);
    if (!rows.length) throw new NotFoundException('Объект недоступен в филиале соединения');
    return rows[0];
  }
  private async dto<T>(payload: Record<string, unknown>, metatype: new () => T): Promise<T> {
    return this.validator.transform(payload, { type: 'body', metatype });
  }

  async apply(connection: Connection, event: ImportEvent, mappedId: string | null): Promise<string> {
    const { tenant_id: tenant, point_id: point, created_by: owner } = connection;
    const actor = { userID: owner, tenantID: tenant, currentPointId: point, role: 'director', permissions: {} };
    const payload = event.payload;
    if (event.entityType === 'products' || event.entityType === 'clients') {
      const data =
        event.entityType === 'products'
          ? only(payload, ['name', 'category', 'barcode', 'unit', 'costPrice', 'sellPrice', 'minStock'])
          : only(payload, ['fullName', 'phone', 'comment']);
      if (event.entityType === 'products') {
        if (!mappedId || data.name !== undefined) requiredText(data.name, 500);
        for (const key of ['category', 'barcode', 'unit'])
          if (data[key] !== undefined && (typeof data[key] !== 'string' || (data[key] as string).length > 500))
            throw new BadRequestException('Некорректная категория, штрихкод или единица товара');
        for (const key of ['costPrice', 'sellPrice', 'minStock'])
          if (
            data[key] !== undefined &&
            (typeof data[key] !== 'number' ||
              !Number.isFinite(data[key]) ||
              (data[key] as number) < 0 ||
              (data[key] as number) > 10_000_000)
          )
            throw new BadRequestException('Некорректная цена или минимальный остаток');
        await this.dto(data, mappedId ? UpdateProductDto : CreateProductDto);
      } else {
        if (!mappedId || data.fullName !== undefined) requiredText(data.fullName, 500);
        for (const key of ['phone', 'comment'])
          if (data[key] !== undefined && (typeof data[key] !== 'string' || (data[key] as string).length > 2000))
            throw new BadRequestException('Некорректный контакт клиента');
      }
      if (mappedId) return this.updateCatalogCAS(connection, event, mappedId, data);
      if (event.baseRevision) throw new ConflictException('Объект ещё не сопоставлен');
      const created =
        event.entityType === 'products'
          ? await this.products.create(tenant, { ...data, stock: 0 }, point)
          : await this.clients.create(tenant, data, point);
      return created.id;
    }
    if (mappedId) throw new ConflictException('Документ уже сопоставлен. Изменение истории требует проверки');
    if (event.entityType === 'purchases') {
      const data = await this.dto(only(payload, ['supplierId', 'note', 'items']), CreatePurchaseOrderDto);
      if (data.items.length > 500) throw new BadRequestException('Не больше 500 строк закупки');
      return (await this.purchases.create(tenant, owner, data, point)).id;
    }
    if (event.entityType === 'workOrders') {
      const data = await this.dto(
        only(payload, ['masterId', 'clientId', 'carId', 'date', 'comment', 'services', 'products']),
        CreateCheckDto,
      );
      // Source document creates a deferred work order, never a paid sale or an
      // inventory operation. Payment requires a separate, explicitly enabled event.
      return (
        await this.checks.create(
          tenant,
          owner,
          'director',
          { ...data, isDeferred: true, cashAmount: 0, cardAmount: 0, clientRequestId: randomUUID() },
          actor,
        )
      ).id;
    }
    if (event.entityType === 'stock') {
      const data = only(payload, ['productId', 'type', 'quantity', 'reason', 'expectedStock', 'expectedWarehouseId']);
      const id = uuid(data.productId);
      const expectedWarehouseId = uuid(data.expectedWarehouseId);
      if (
        !['income', 'expense'].includes(String(data.type)) ||
        typeof data.quantity !== 'number' ||
        !Number.isFinite(data.quantity) ||
        data.quantity <= 0 ||
        data.quantity > 10_000_000 ||
        Math.abs(data.quantity * 1000 - Math.round(data.quantity * 1000)) > 0.0000001 ||
        typeof data.expectedStock !== 'number' ||
        !Number.isFinite(data.expectedStock)
      )
        throw new BadRequestException('Остатки передаются только движением income/expense с положительным количеством');
      // externalId identifies one source movement, not a balance snapshot.
      // The native transaction checks the expected balance and warehouse under
      // its row lock, and refuses an insufficient expense before any clamping.
      await this.snapshot(connection, 'stock', id);
      await this.products.updateStock(
        id,
        tenant,
        {
          type: data.type,
          quantity: data.quantity,
          reason: typeof data.reason === 'string' ? data.reason.slice(0, 500) : 'Обмен 1С',
          recordAsExpense: false,
        },
        owner,
        point,
        { expectedStock: data.expectedStock, expectedWarehouseId, requireSufficientStock: true },
      );
      return id;
    }
    const data = only(payload, ['checkId', 'paymentMethod', 'cashAmount', 'cardAmount']);
    const id = uuid(data.checkId);
    if (!['cash', 'card', 'cash_card'].includes(String(data.paymentMethod)))
      throw new BadRequestException('Пилот принимает только нал, карту или смешанную оплату');
    const check = await this.snapshot(connection, 'workOrders', id);
    if (check.payload.isDeferred !== true || check.payload.deletedAt)
      throw new ConflictException('Оплата проведённого/удалённого чека требует проверки');
    const expectedTotalRevenue = Math.round(Number(check.payload.totalRevenue) * 100) / 100;
    const cash = Number(data.cashAmount ?? 0),
      card = Number(data.cardAmount ?? 0);
    if (
      Math.round((cash + card) * 100) / 100 !== expectedTotalRevenue ||
      (data.paymentMethod === 'cash' && card !== 0) ||
      (data.paymentMethod === 'card' && cash !== 0)
    ) {
      throw new ConflictException('Сумма и способ оплаты не совпадают с заказ-нарядом');
    }
    const { checkId: _checkId, ...payment } = data;
    const dto = await this.dto(payment, AcceptPaymentDto);
    // ChecksService serializes closure and same-value retries under FOR UPDATE.
    // Passing only cash/card avoids arbitrary ledger rewrites and installments.
    await this.checks.acceptPayment(id, tenant, 'director', dto, owner, actor, {
      onlyDeferred: true,
      expectedTotalRevenue,
    });
    return id;
  }

  private async updateCatalogCAS(
    connection: Connection,
    event: ImportEvent,
    id: string,
    data: Record<string, unknown>,
  ) {
    if (!event.baseRevision) throw new ConflictException('Для изменения требуется baseRevision');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await this.snapshot(connection, event.entityType, id, client, true);
      if (current.payload.deletedAt || digest(current.payload) !== event.baseRevision)
        throw new ConflictException('Объект изменён в Autexa; нужна сверка версий');
      if (Object.keys(data).length) {
        if (event.entityType === 'products')
          await this.products.update(
            id,
            connection.tenant_id,
            data,
            connection.created_by,
            connection.point_id,
            client,
          );
        else await this.clients.update(id, connection.tenant_id, data, connection.point_id, client);
      }
      await client.query('COMMIT');
      return id;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
