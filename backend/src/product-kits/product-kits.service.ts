import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { createHash } from 'crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PG_POOL } from '../database.module';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId } from '../common/point-scope';
import { userHasPermission } from '../common/guards/permissions.guard';
import { assertInventoryFeature } from '../common/inventory-features';
import { ProductsService } from '../products/products.service';
import { cents, decimal, positiveQuantity, stockUnits } from '../suppliers/procurement-money';
import { AssembleKitDto, DisassembleKitDto, KitRecipeDto, RecomposeKitDto } from './product-kits.dto';
import { assertKitPlace, disassembleKitTx, KitProduct, kitMovement, kitOperationId, kitWrite } from './kit-stock';

export function kitFingerprint(value: unknown): string {
  const ordered = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(ordered)
      : item && typeof item === 'object'
        ? Object.fromEntries(
            Object.entries(item)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, value]) => [key, ordered(value)]),
          )
        : item;
  return createHash('sha256')
    .update(JSON.stringify(ordered(value)))
    .digest('hex');
}

@Injectable()
export class ProductKitsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly products: ProductsService,
  ) {}

  private assert(actor: JwtPayload, write = true) {
    assertInventoryFeature(actor.tenantID);
    if (!userHasPermission(actor, write ? 'warehouse_manage' : 'warehouse_access'))
      throw new ForbiddenException('Недостаточно прав для работы с комплектами');
  }

  async get(productId: string, actor: JwtPayload) {
    this.assert(actor, false);
    const { rows } = await this.pool.query(
      `SELECT a.*,p.stock,p.name,p.sell_price,p.warehouse_id FROM product_assemblies a JOIN products p ON p.assembly_id=a.id
      JOIN warehouses w ON w.id=p.warehouse_id WHERE p.id=$1 AND p.tenant_id=$2 AND a.tenant_id=$2 AND p.deleted_at IS NULL
      AND ($3::uuid IS NULL OR w.point_id=$3)`,
      [productId, actor.tenantID, actorPointId(actor)],
    );
    if (!rows.length) throw new NotFoundException('Собранный комплект не найден');
    const row = rows[0],
      cost = userHasPermission(actor, 'warehouse_manage');
    const components = (
      await this.pool.query(
        'SELECT * FROM product_assembly_components WHERE assembly_id=$1 AND tenant_id=$2 ORDER BY source_product_id',
        [row.id, actor.tenantID],
      )
    ).rows;
    return {
      id: row.id,
      productId,
      name: row.name,
      revision: row.revision,
      quantity: Number(row.stock),
      assembledQuantity: row.assembled_quantity,
      sellPrice: Number(row.sell_price),
      ...(cost ? { costPrice: Number(row.unit_cost) } : {}),
      warehouseId: row.warehouse_id,
      recipeId: row.recipe_id,
      recipeVersion: row.recipe_version,
      components: components.map((component) => ({
        productId: component.source_product_id,
        name: component.product_snapshot.name,
        quantity: Number(component.quantity),
        ...(cost ? { costPrice: Number(component.unit_cost) } : {}),
        warehouseId: component.source_warehouse_id,
        category: component.source_category,
        storageCellId: component.source_cell_id,
      })),
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
  }

  async recipes(actor: JwtPayload) {
    this.assert(actor, false);
    const { rows } = await this.pool.query(
      'SELECT id,name,version,components FROM kit_recipes WHERE tenant_id=$1 AND ($2::uuid IS NULL OR point_id=$2) ORDER BY name,id',
      [actor.tenantID, actorPointId(actor)],
    );
    return rows;
  }

  async recipe(id: string, actor: JwtPayload, version?: string) {
    this.assert(actor, false);
    if (version !== undefined && (typeof version !== 'string' || !/^[1-9]\d{0,8}$/.test(version)))
      throw new BadRequestException('Некорректная версия рецепта');
    const { rows } = await this.pool.query(
      `SELECT r.id,v.name,v.version,v.components FROM kit_recipes r
      JOIN kit_recipe_versions v ON v.recipe_id=r.id AND v.tenant_id=r.tenant_id AND v.version=COALESCE($4::int,r.version)
      WHERE r.id=$1 AND r.tenant_id=$2 AND ($3::uuid IS NULL OR r.point_id=$3)`,
      [id, actor.tenantID, actorPointId(actor), version ?? null],
    );
    if (!rows.length) throw new NotFoundException('Рецепт комплекта не найден');
    return rows[0];
  }

  private async saveRecipeTx(
    client: PoolClient,
    dto: KitRecipeDto,
    actor: JwtPayload,
    id?: string,
    expectedVersion?: number,
  ) {
    const ids = dto.components.map((item) => item.productId);
    const found = await client.query(
      `SELECT p.id FROM products p JOIN warehouses w ON w.id=p.warehouse_id
      WHERE p.tenant_id=$1 AND p.id=ANY($2::uuid[]) AND p.deleted_at IS NULL AND p.assembly_id IS NULL
      AND ($3::uuid IS NULL OR w.point_id=$3)`,
      [actor.tenantID, ids, actorPointId(actor)],
    );
    if (found.rows.length !== ids.length)
      throw new BadRequestException('Выберите доступные компоненты текущего филиала');
    const { rows } = id
      ? await client.query(
          `UPDATE kit_recipes SET name=$3,components=$4,version=version+1,updated_at=now()
      WHERE id=$1 AND tenant_id=$2 AND version=$5 AND ($6::uuid IS NULL OR point_id=$6) RETURNING id,name,version,components`,
          [id, actor.tenantID, dto.name.trim(), JSON.stringify(dto.components), expectedVersion, actorPointId(actor)],
        )
      : await client.query(
          `INSERT INTO kit_recipes(tenant_id,name,components,created_by,point_id)
        VALUES($1,$2,$3,$4,$5) RETURNING id,name,version,components`,
          [actor.tenantID, dto.name.trim(), JSON.stringify(dto.components), actor.userID, actorPointId(actor)],
        );
    if (!rows.length) throw new ConflictException('Рецепт изменился. Обновите список');
    const result = rows[0];
    await client.query(
      'INSERT INTO kit_recipe_versions(tenant_id,recipe_id,version,name,components,created_by) VALUES($1,$2,$3,$4,$5,$6)',
      [actor.tenantID, result.id, result.version, result.name, JSON.stringify(result.components), actor.userID],
    );
    return result;
  }

  async saveRecipe(dto: KitRecipeDto, actor: JwtPayload, id?: string, expectedVersion?: number) {
    this.assert(actor);
    if (validateSync(plainToInstance(KitRecipeDto, dto)).length || !dto.name.trim())
      throw new BadRequestException('Проверьте название и состав рецепта');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await this.saveRecipeTx(client, dto, actor, id, expectedVersion);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async operation<T>(
    actor: JwtPayload,
    requestId: string,
    kind: string,
    input: unknown,
    work: (client: PoolClient, operationId: string) => Promise<T>,
  ): Promise<T> {
    this.assert(actor);
    const fingerprint = kitFingerprint({ kind, input, pointId: actorPointId(actor) });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `kit-request:${actor.tenantID}:${requestId}`,
      ]);
      const prior = await client.query(
        'SELECT fingerprint,response FROM kit_operations WHERE tenant_id=$1 AND request_id=$2',
        [actor.tenantID, requestId],
      );
      if (prior.rows.length) {
        if (prior.rows[0].fingerprint !== fingerprint)
          throw new ConflictException({
            code: 'KIT_REQUEST_CONFLICT',
            message: 'Этот запрос комплекта уже использован с другими данными',
          });
        await client.query('COMMIT');
        return prior.rows[0].response as T;
      }
      const operationId = kitOperationId();
      const result = await work(client, operationId);
      await client.query(
        'INSERT INTO kit_operations(id,tenant_id,request_id,fingerprint,kind,response,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [operationId, actor.tenantID, requestId, fingerprint, kind, JSON.stringify(result), actor.userID],
      );
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === '55P03')
        throw new ConflictException({
          code: 'KIT_SOURCE_PLACE_BUSY',
          message: 'Место хранения сейчас меняется. Повторите операцию',
        });
      throw error;
    } finally {
      client.release();
    }
  }

  async assemble(dto: AssembleKitDto, actor: JwtPayload) {
    if (validateSync(plainToInstance(AssembleKitDto, dto)).length || !dto.name?.trim())
      throw new BadRequestException('Проверьте название, количество, цену и состав комплекта');
    return this.operation(actor, dto.requestId, 'assemble', dto, (client, operation) =>
      this.assembleTx(client, dto, actor, operation),
    );
  }

  private async assembleTx(client: PoolClient, dto: AssembleKitDto, actor: JwtPayload, operation: string) {
    let recipeId = dto.recipeId,
      recipeVersion: number;
    if (recipeId) {
      const { rows } = await client.query(
        `SELECT r.version AS latest_version,v.version,v.components FROM kit_recipes r
        JOIN kit_recipe_versions v ON v.recipe_id=r.id AND v.tenant_id=r.tenant_id AND v.version=COALESCE($4::int,r.version)
        WHERE r.id=$1 AND r.tenant_id=$2 AND ($3::uuid IS NULL OR r.point_id=$3) FOR SHARE OF r`,
        [recipeId, actor.tenantID, actorPointId(actor), dto.recipeVersion ?? null],
      );
      const selected = rows[0];
      if (
        !selected ||
        (dto.recipeVersion === undefined && selected.latest_version !== dto.expectedRecipeVersion) ||
        kitFingerprint([...selected.components].sort((a, b) => a.productId.localeCompare(b.productId))) !==
          kitFingerprint([...dto.components].sort((a, b) => a.productId.localeCompare(b.productId)))
      )
        throw new ConflictException('Рецепт изменился. Примените выбранную версию заново');
      recipeVersion = selected.version;
    } else {
      if (dto.recipeVersion !== undefined || dto.expectedRecipeVersion !== undefined)
        throw new BadRequestException('Для версии выберите рецепт');
      const recipe = await this.saveRecipeTx(client, dto, actor);
      recipeId = recipe.id;
      recipeVersion = recipe.version;
    }
    const ids = dto.components.map((item) => item.productId).sort();
    const sourceProducts = (
      await client.query(
        `SELECT p.* FROM products p JOIN warehouses w ON w.id=p.warehouse_id
      WHERE p.id=ANY($1::uuid[]) AND p.tenant_id=$2 AND p.deleted_at IS NULL AND ($3::uuid IS NULL OR w.point_id=$3)
      ORDER BY p.id FOR UPDATE OF p`,
        [ids, actor.tenantID, actorPointId(actor)],
      )
    ).rows as KitProduct[];
    if (sourceProducts.length !== ids.length)
      throw new BadRequestException('Компонент не найден на складе текущего филиала');
    const sources = new Map(sourceProducts.map((product) => [product.id, product]));
    let costMilliCents = 0n;
    for (const component of dto.components) {
      const product = sources.get(component.productId)!;
      if (product.assembly_id) throw new BadRequestException('Вложенный собранный комплект сначала разберите');
      if (product.cost_price_is_placeholder)
        throw new ConflictException({
          code: 'PRODUCT_COST_CONFIRMATION_REQUIRED',
          message: 'Подтвердите себестоимость всех компонентов перед сборкой',
        });
      const units = positiveQuantity(component.quantity) * BigInt(dto.quantity);
      if (stockUnits(product.stock) < units)
        throw new ConflictException({
          code: 'KIT_COMPONENT_STOCK_INSUFFICIENT',
          message: `Недостаточно товара: ${product.name}`,
        });
      await assertKitPlace(
        client,
        actor.tenantID,
        actorPointId(actor),
        product.warehouse_id,
        product.category,
        product.storage_cell_id,
      );
      costMilliCents += cents(product.cost_price) * positiveQuantity(component.quantity);
    }
    const exactUnitCost = decimal(costMilliCents, 5);
    const unitCost = Number(exactUnitCost);
    const legacyCost = Number(decimal((costMilliCents + 500n) / 1000n, 2));
    cents(legacyCost);
    await kitWrite(client);
    const product = await this.products.create(
      actor.tenantID,
      {
        name: dto.name.trim(),
        warehouseId: dto.warehouseId,
        category: dto.category,
        storageCellId: dto.storageCellId,
        costPrice: legacyCost,
        sellPrice: dto.sellPrice,
        stock: 0,
        isBundle: true,
        bundleItems: dto.components.map((component) => ({
          productId: component.productId,
          name: sources.get(component.productId)!.name,
          quantity: component.quantity,
        })),
      },
      actorPointId(actor),
      client,
    );
    const assemblyId = kitOperationId();
    await client.query(
      'INSERT INTO product_assemblies(id,tenant_id,product_id,recipe_id,point_id,assembled_quantity,unit_cost,created_by,recipe_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        assemblyId,
        actor.tenantID,
        product.id,
        recipeId,
        actorPointId(actor),
        dto.quantity,
        unitCost,
        actor.userID,
        recipeVersion,
      ],
    );
    await client.query(
      'UPDATE products SET assembly_id=$3,assembly_revision=1,assembly_exact_cost=$4 WHERE id=$1 AND tenant_id=$2',
      [product.id, actor.tenantID, assemblyId, exactUnitCost],
    );
    for (const component of dto.components) {
      const source = sources.get(component.productId)!;
      await client.query(
        `INSERT INTO product_assembly_components(tenant_id,assembly_id,source_product_id,source_warehouse_id,source_category,source_cell_id,quantity,unit_cost,product_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          actor.tenantID,
          assemblyId,
          source.id,
          source.warehouse_id,
          source.category,
          source.storage_cell_id,
          component.quantity,
          source.cost_price,
          JSON.stringify(source),
        ],
      );
      await kitMovement(
        client,
        actor.tenantID,
        actor.userID,
        source,
        'kit_assembly',
        -positiveQuantity(component.quantity) * BigInt(dto.quantity),
        operation,
        assemblyId,
        source.id,
      );
    }
    const kit = (
      await client.query('SELECT * FROM products WHERE id=$1 AND tenant_id=$2', [product.id, actor.tenantID])
    ).rows[0] as KitProduct;
    await kitMovement(
      client,
      actor.tenantID,
      actor.userID,
      kit,
      'kit_assembly',
      BigInt(dto.quantity) * 1000n,
      operation,
      assemblyId,
    );
    return {
      productId: product.id,
      recipeId,
      recipeVersion,
      assemblyId,
      revision: 1,
      quantity: dto.quantity,
      costPrice: unitCost,
      sellPrice: dto.sellPrice,
      operationId: operation,
    };
  }

  async disassemble(productId: string, dto: DisassembleKitDto, actor: JwtPayload) {
    if (validateSync(plainToInstance(DisassembleKitDto, dto)).length)
      throw new BadRequestException('Проверьте количество и версию комплекта');
    return this.operation(actor, dto.requestId, 'disassemble', { productId, ...dto }, async (client, operation) => ({
      ...(await disassembleKitTx(
        client,
        actor.tenantID,
        actorPointId(actor),
        actor.userID,
        productId,
        dto.expectedRevision,
        dto.quantity,
        operation,
      )),
      operationId: operation,
    }));
  }

  async recompose(productId: string, dto: RecomposeKitDto, actor: JwtPayload) {
    if (validateSync(plainToInstance(RecomposeKitDto, dto)).length || !dto.name.trim())
      throw new BadRequestException('Проверьте новый состав комплекта');
    return this.operation(actor, dto.requestId, 'recompose', { productId, ...dto }, async (client, operation) => {
      const released = await disassembleKitTx(
        client,
        actor.tenantID,
        actorPointId(actor),
        actor.userID,
        productId,
        dto.expectedRevision,
        dto.quantity,
        operation,
        dto.components.map((component) => component.productId),
      );
      const assembled = await this.assembleTx(client, dto, actor, operation);
      return { ...assembled, previousAssemblyId: released.assemblyId, previousRevision: released.revision };
    });
  }
}
