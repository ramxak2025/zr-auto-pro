import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Product } from './entities/product.entity';
import {
  StockMovement,
  MovementType,
} from './entities/stock-movement.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly repo: Repository<Product>,
    @InjectRepository(StockMovement)
    private readonly movementRepo: Repository<StockMovement>,
  ) {}

  async findAll(tenantId: string, query: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    lowStock?: boolean;
  }): Promise<{ data: Product[]; total: number; page: number; limit: number }> {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const qb = this.repo.createQueryBuilder('product');

    qb.where('product.tenantId = :tenantId', { tenantId });

    if (query.search) {
      qb.andWhere('product.name ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    if (query.category) {
      qb.andWhere('product.category = :category', {
        category: query.category,
      });
    }

    if (query.lowStock === true || query.lowStock === ('true' as any)) {
      qb.andWhere('product.stock <= product.minStock');
    }

    qb.orderBy('product.name', 'ASC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findById(tenantId: string, id: string): Promise<Product> {
    const product = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['supplier'],
    });

    if (!product) {
      throw new NotFoundException(`Product with ID "${id}" not found`);
    }

    return product;
  }

  async create(tenantId: string, dto: CreateProductDto): Promise<Product> {
    const product = this.repo.create({ ...dto, tenantId });
    return this.repo.save(product);
  }

  async update(tenantId: string, id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findById(tenantId, id);
    Object.assign(product, dto);
    return this.repo.save(product);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const product = await this.findById(tenantId, id);
    await this.repo.softRemove(product);
  }

  async getCategories(tenantId: string): Promise<string[]> {
    const results = await this.repo
      .createQueryBuilder('product')
      .select('DISTINCT product.category', 'category')
      .where('product.tenantId = :tenantId', { tenantId })
      .andWhere('product.category IS NOT NULL')
      .andWhere('product.category != :empty', { empty: '' })
      .orderBy('product.category', 'ASC')
      .getRawMany();

    return results.map((r) => r.category);
  }

  async adjustStock(
    tenantId: string,
    productId: string,
    quantity: number,
    type: MovementType,
    userId: string,
    reason?: string,
    referenceId?: string,
  ): Promise<StockMovement> {
    const product = await this.findById(tenantId, productId);
    const stockBefore = product.stock;

    let stockAfter: number;

    switch (type) {
      case MovementType.INCOME:
        stockAfter = stockBefore + Math.abs(quantity);
        break;
      case MovementType.EXPENSE:
      case MovementType.WRITEOFF:
        stockAfter = stockBefore - Math.abs(quantity);
        if (stockAfter < 0) {
          throw new BadRequestException(
            `Insufficient stock. Current: ${stockBefore}, requested: ${Math.abs(quantity)}`,
          );
        }
        break;
      case MovementType.INVENTORY:
        stockAfter = quantity;
        break;
      default:
        throw new BadRequestException(`Unknown movement type: ${type}`);
    }

    const movement = this.movementRepo.create({
      productId,
      type,
      quantity,
      stockBefore,
      stockAfter,
      reason,
      referenceId,
      userId,
      tenantId,
    });

    await this.movementRepo.save(movement);

    product.stock = stockAfter;
    await this.repo.save(product);

    return movement;
  }

  async getMovements(
    tenantId: string,
    productId: string,
    query: { page?: number; limit?: number },
  ): Promise<{ data: StockMovement[]; total: number; page: number; limit: number }> {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await this.movementRepo.findAndCount({
      where: { productId, tenantId },
      order: { createdAt: 'DESC' },
      relations: ['user'],
      skip,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async getLowStockProducts(tenantId: string): Promise<Product[]> {
    return this.repo
      .createQueryBuilder('product')
      .where('product.tenantId = :tenantId', { tenantId })
      .andWhere('product.stock <= product.minStock')
      .orderBy('product.name', 'ASC')
      .getMany();
  }

  async inventoryAdjust(
    tenantId: string,
    productId: string,
    actualStock: number,
    userId: string,
    reason?: string,
  ): Promise<StockMovement> {
    return this.adjustStock(
      tenantId,
      productId,
      actualStock,
      MovementType.INVENTORY,
      userId,
      reason || 'Inventory adjustment',
    );
  }
}
