import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, ILike, LessThanOrEqual } from 'typeorm';

import { Product } from './product.entity';
import { StockMovement } from './stock-movement.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productsRepo: Repository<Product>,

    @InjectRepository(StockMovement)
    private readonly stockMovementsRepo: Repository<StockMovement>,
  ) {}

  async findAll(
    tenantId: string,
    search?: string,
    category?: string,
  ): Promise<Product[]> {
    const where: FindOptionsWhere<Product> = { tenantId };

    if (search) {
      where.name = ILike(`%${search}%`);
    }

    if (category) {
      where.category = category;
    }

    return this.productsRepo.find({
      where,
      relations: ['supplier'],
      order: { name: 'ASC' },
    });
  }

  async findById(id: string): Promise<Product> {
    const product = await this.productsRepo.findOne({
      where: { id },
      relations: ['supplier'],
    });
    if (!product) {
      throw new NotFoundException(`Product with id "${id}" not found`);
    }
    return product;
  }

  async create(dto: Partial<Product>): Promise<Product> {
    const product = this.productsRepo.create(dto);
    return this.productsRepo.save(product);
  }

  async update(id: string, dto: Partial<Product>): Promise<Product> {
    const product = await this.productsRepo.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product with id "${id}" not found`);
    }
    Object.assign(product, dto);
    return this.productsRepo.save(product);
  }

  async remove(id: string): Promise<void> {
    const result = await this.productsRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Product with id "${id}" not found`);
    }
  }

  async updateStock(
    id: string,
    quantity: number,
    type: 'income' | 'expense' | 'writeoff' | 'inventory',
    reason?: string,
  ): Promise<Product> {
    const product = await this.productsRepo.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product with id "${id}" not found`);
    }

    const stockBefore = product.stock;
    let stockAfter: number;

    switch (type) {
      case 'income':
        stockAfter = stockBefore + quantity;
        break;
      case 'expense':
      case 'writeoff':
        stockAfter = stockBefore - quantity;
        break;
      case 'inventory':
        stockAfter = quantity;
        break;
    }

    const movement = this.stockMovementsRepo.create({
      tenantId: product.tenantId,
      productId: product.id,
      type,
      quantity,
      stockBefore,
      stockAfter,
      reason,
    });

    product.stock = stockAfter;

    await this.stockMovementsRepo.save(movement);
    return this.productsRepo.save(product);
  }

  async getStockMovements(
    tenantId: string,
    productId?: string,
  ): Promise<StockMovement[]> {
    const where: FindOptionsWhere<StockMovement> = { tenantId };

    if (productId) {
      where.productId = productId;
    }

    return this.stockMovementsRepo.find({
      where,
      relations: ['product'],
      order: { createdAt: 'DESC' },
    });
  }

  async getLowStock(tenantId: string): Promise<Product[]> {
    return this.productsRepo
      .createQueryBuilder('product')
      .where('product.tenantId = :tenantId', { tenantId })
      .andWhere('product.stock <= product.minStock')
      .orderBy('product.name', 'ASC')
      .getMany();
  }
}
