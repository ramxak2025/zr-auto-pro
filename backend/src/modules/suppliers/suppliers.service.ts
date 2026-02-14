import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { Delivery } from './entities/delivery.entity';
import { DeliveryItem } from './entities/delivery-item.entity';
import { SupplierPayment } from './entities/supplier-payment.entity';
import { ProductsService } from '../products/products.service';
import { MovementType } from '../products/entities/stock-movement.entity';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly repo: Repository<Supplier>,
    @InjectRepository(Delivery)
    private readonly deliveryRepo: Repository<Delivery>,
    @InjectRepository(DeliveryItem)
    private readonly deliveryItemRepo: Repository<DeliveryItem>,
    @InjectRepository(SupplierPayment)
    private readonly paymentRepo: Repository<SupplierPayment>,
    private readonly productsService: ProductsService,
    private readonly dataSource: DataSource,
  ) {}

  // ─── Supplier CRUD ───────────────────────────────────────────

  async findAll(tenantId: string, query: { page?: number; limit?: number; search?: string }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.repo.createQueryBuilder('supplier');

    qb.where('supplier.tenantId = :tenantId', { tenantId });

    if (query.search) {
      qb.andWhere('supplier.name ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    qb.orderBy('supplier.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findById(tenantId: string, id: string): Promise<Supplier> {
    const supplier = await this.repo.findOne({
      where: { id, tenantId },
      relations: ['deliveries', 'payments'],
    });

    if (!supplier) {
      throw new NotFoundException(`Supplier with id ${id} not found`);
    }

    return supplier;
  }

  async create(tenantId: string, dto: CreateSupplierDto): Promise<Supplier> {
    const supplier = this.repo.create({ ...dto, tenantId });
    return this.repo.save(supplier);
  }

  async update(tenantId: string, id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    const supplier = await this.findById(tenantId, id);
    Object.assign(supplier, dto);
    return this.repo.save(supplier);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const supplier = await this.findById(tenantId, id);
    await this.repo.softRemove(supplier);
  }

  // ─── Deliveries ──────────────────────────────────────────────

  async createDelivery(tenantId: string, dto: CreateDeliveryDto, userId: string): Promise<Delivery> {
    return this.dataSource.transaction(async (manager) => {
      // Lock supplier row to prevent concurrent financial updates
      const supplier = await manager
        .createQueryBuilder(Supplier, 'supplier')
        .setLock('pessimistic_write')
        .where('supplier.id = :id AND supplier.tenantId = :tenantId', {
          id: dto.supplierId,
          tenantId,
        })
        .getOne();

      if (!supplier) {
        throw new NotFoundException(`Supplier with id ${dto.supplierId} not found`);
      }

      // Build delivery items and calculate totals
      const deliveryItems: Partial<DeliveryItem>[] = [];
      let totalAmount = 0;

      for (const item of dto.items) {
        const itemTotal = Math.round(item.quantity * item.price * 100) / 100;
        totalAmount += itemTotal;

        deliveryItems.push({
          productId: item.productId,
          quantity: item.quantity,
          price: item.price,
          total: itemTotal,
        });
      }

      totalAmount = Math.round(totalAmount * 100) / 100;

      // Create and save the delivery with items (cascade saves items)
      const delivery = manager.create(Delivery, {
        supplierId: dto.supplierId,
        comment: dto.comment,
        date: dto.date || new Date(),
        totalAmount,
        tenantId,
        items: deliveryItems as DeliveryItem[],
      });

      const savedDelivery = await manager.save(Delivery, delivery);

      // For each item: adjust product stock and update costPrice
      for (const item of dto.items) {
        await this.productsService.adjustStock(
          tenantId,
          item.productId,
          item.quantity,
          MovementType.INCOME,
          userId,
          'Поставка',
          savedDelivery.id,
        );

        // Update product costPrice to the delivery price
        await this.productsService.update(tenantId, item.productId, {
          costPrice: item.price,
        });
      }

      // Update supplier financial totals atomically
      supplier.totalPurchases = Math.round((Number(supplier.totalPurchases) + totalAmount) * 100) / 100;
      supplier.currentDebt = Math.round((Number(supplier.currentDebt) + totalAmount) * 100) / 100;
      await manager.save(Supplier, supplier);

      return savedDelivery;
    });
  }

  async getDeliveries(
    tenantId: string,
    supplierId: string,
    query: { page?: number; limit?: number },
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await this.deliveryRepo.findAndCount({
      where: { supplierId, tenantId },
      relations: ['items', 'items.product'],
      order: { date: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit };
  }

  // ─── Payments ────────────────────────────────────────────────

  async createPayment(tenantId: string, dto: CreatePaymentDto): Promise<SupplierPayment> {
    return this.dataSource.transaction(async (manager) => {
      // Lock supplier row to prevent concurrent financial updates
      const supplier = await manager
        .createQueryBuilder(Supplier, 'supplier')
        .setLock('pessimistic_write')
        .where('supplier.id = :id AND supplier.tenantId = :tenantId', {
          id: dto.supplierId,
          tenantId,
        })
        .getOne();

      if (!supplier) {
        throw new NotFoundException(`Supplier with id ${dto.supplierId} not found`);
      }

      const payment = manager.create(SupplierPayment, {
        supplierId: dto.supplierId,
        amount: dto.amount,
        comment: dto.comment,
        date: dto.date || new Date(),
        tenantId,
      });

      const savedPayment = await manager.save(SupplierPayment, payment);

      // Update supplier financial totals atomically
      supplier.totalPaid = Math.round((Number(supplier.totalPaid) + dto.amount) * 100) / 100;
      supplier.currentDebt = Math.round((Number(supplier.currentDebt) - dto.amount) * 100) / 100;
      await manager.save(Supplier, supplier);

      return savedPayment;
    });
  }

  async getPayments(
    tenantId: string,
    supplierId: string,
    query: { page?: number; limit?: number },
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const [data, total] = await this.paymentRepo.findAndCount({
      where: { supplierId, tenantId },
      order: { date: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total, page, limit };
  }
}
