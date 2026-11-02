import { rethrowBarcodeReservationError } from './barcode-reservation-policy';
import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { validateSync } from 'class-validator';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { assertInventoryFeature } from '../common/inventory-features';
import { actorPointId } from '../common/point-scope';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { WarehousesService } from '../warehouses/warehouses.service';
import { ProductsService } from './products.service';
import { UsedIntakeDto } from './dto/used-intake.dto';

@Injectable()
export class UsedIntakeService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly products: ProductsService,
    private readonly movements: StockMovementsService,
    private readonly warehouses: WarehousesService,
  ) {}

  async create(dto: UsedIntakeDto, actor: JwtPayload) {
    assertInventoryFeature(actor.tenantID);
    if (
      validateSync(Object.assign(new UsedIntakeDto(), dto)).length ||
      !dto.name.trim() ||
      dto.supplierId ||
      dto.isBundle ||
      dto.bundleItems?.length ||
      (dto.stock !== undefined && dto.stock !== 0) ||
      !Number.isFinite(dto.costPrice) ||
      Number(dto.costPrice) < 0 ||
      !Number.isFinite(dto.sellPrice) ||
      Number(dto.sellPrice) < 0
    ) {
      throw new BadRequestException('Проверьте название, количество и цены товара Б/У');
    }
    const pointId = actorPointId(actor);
    const warehouse = await this.warehouses.resolveByKind(actor.tenantID, 'used', pointId);
    if (dto.warehouseId && dto.warehouseId !== warehouse.id) throw new BadRequestException('Выберите склад Б/У');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          pointId,
          name: dto.name.trim(),
          category: dto.category ?? '',
          photo: dto.photo ?? null,
          photos: dto.photos,
          quantity: dto.quantity,
          costPrice: dto.costPrice,
          sellPrice: dto.sellPrice,
          unit: dto.unit ?? 'шт',
          storageCellId: dto.storageCellId ?? null,
          brand: dto.brand ?? '',
          article: dto.article ?? '',
          packaging: dto.packaging ?? '',
          barcode: dto.barcode ?? null,
          warrantyDays: dto.warrantyDays ?? null,
          minStock: dto.minStock ?? 0,
        }),
      )
      .digest('hex');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `used-intake:${actor.tenantID}:${dto.requestId}`,
      ]);
      const prior = await client.query(
        'SELECT fingerprint,response FROM used_intake_requests WHERE tenant_id=$1 AND request_id=$2',
        [actor.tenantID, dto.requestId],
      );
      if (prior.rows.length) {
        if (prior.rows[0].fingerprint !== fingerprint)
          throw new ConflictException('Этот запрос уже использован для другого товара');
        await client.query('COMMIT');
        return prior.rows[0].response;
      }
      const product = await this.products.create(
        actor.tenantID,
        { ...dto, name: dto.name.trim(), warehouseId: warehouse.id, stock: 0, supplierId: null },
        pointId,
        client,
      );
      await this.movements.applyIncomeTx(client, actor.tenantID, actor.userID, {
        productId: product.id,
        quantity: dto.quantity,
        purchasePrice: dto.costPrice,
        warehouseId: warehouse.id,
        reason: 'Добавление товара Б/У',
        pointId,
      });
      product.stock = dto.quantity;
      const response = { product, requestId: dto.requestId };
      await client.query(
        'INSERT INTO used_intake_requests(tenant_id,request_id,fingerprint,response) VALUES($1,$2,$3,$4)',
        [actor.tenantID, dto.requestId, fingerprint, JSON.stringify(response)],
      );
      await client.query('COMMIT');
      return response;
    } catch (error) {
      await client.query('ROLLBACK');
      rethrowBarcodeReservationError(error);
      throw error;
    } finally {
      client.release();
    }
  }
}
