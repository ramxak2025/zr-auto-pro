import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, ILike } from 'typeorm';

import { Supplier } from './supplier.entity';
import { Delivery } from './delivery.entity';
import { DeliveryItem } from './delivery-item.entity';
import { SupplierPayment } from './supplier-payment.entity';
import { ProductsService } from '../products/products.service';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier)
    private readonly suppliersRepo: Repository<Supplier>,

    @InjectRepository(Delivery)
    private readonly deliveriesRepo: Repository<Delivery>,

    @InjectRepository(DeliveryItem)
    private readonly deliveryItemsRepo: Repository<DeliveryItem>,

    @InjectRepository(SupplierPayment)
    private readonly paymentsRepo: Repository<SupplierPayment>,

    private readonly productsService: ProductsService,
  ) {}

  // ── Suppliers ──────────────────────────────────────────────

  async findAll(tenantId: string, search?: string): Promise<Supplier[]> {
    const where: FindOptionsWhere<Supplier> = { tenantId };

    if (search) {
      where.name = ILike(`%${search}%`);
    }

    return this.suppliersRepo.find({
      where,
      order: { name: 'ASC' },
    });
  }

  async findById(id: string): Promise<Supplier> {
    const supplier = await this.suppliersRepo.findOne({ where: { id } });
    if (!supplier) {
      throw new NotFoundException(`Supplier with id "${id}" not found`);
    }
    return supplier;
  }

  async create(dto: Partial<Supplier>): Promise<Supplier> {
    const supplier = this.suppliersRepo.create(dto);
    return this.suppliersRepo.save(supplier);
  }

  async update(id: string, dto: Partial<Supplier>): Promise<Supplier> {
    const supplier = await this.suppliersRepo.findOne({ where: { id } });
    if (!supplier) {
      throw new NotFoundException(`Supplier with id "${id}" not found`);
    }
    Object.assign(supplier, dto);
    return this.suppliersRepo.save(supplier);
  }

  async remove(id: string): Promise<void> {
    const result = await this.suppliersRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Supplier with id "${id}" not found`);
    }
  }

  // ── Deliveries ─────────────────────────────────────────────

  async getDeliveries(
    tenantId: string,
    supplierId?: string,
  ): Promise<Delivery[]> {
    const where: FindOptionsWhere<Delivery> = { tenantId };

    if (supplierId) {
      where.supplierId = supplierId;
    }

    return this.deliveriesRepo.find({
      where,
      relations: ['supplier', 'items', 'items.product'],
      order: { date: 'DESC' },
    });
  }

  async createDelivery(dto: Partial<Delivery> & { items: Partial<DeliveryItem>[] }): Promise<Delivery> {
    const supplier = await this.findById(dto.supplierId);

    // Calculate totals for each item and overall total
    let totalAmount = 0;
    const items = dto.items.map((item) => {
      const total = item.quantity * item.price;
      totalAmount += total;
      return this.deliveryItemsRepo.create({
        ...item,
        total,
      });
    });

    const delivery = this.deliveriesRepo.create({
      tenantId: dto.tenantId,
      supplierId: dto.supplierId,
      date: dto.date,
      comment: dto.comment,
      paymentStatus: dto.paymentStatus || 'unpaid',
      totalAmount,
      items,
    });

    const savedDelivery = await this.deliveriesRepo.save(delivery);

    // Update stock for each item
    for (const item of dto.items) {
      await this.productsService.updateStock(
        item.productId,
        item.quantity,
        'income',
        'Поставка от ' + supplier.name,
      );
    }

    // Update supplier aggregates
    supplier.totalPurchases += totalAmount;
    supplier.currentDebt += totalAmount;
    await this.suppliersRepo.save(supplier);

    return savedDelivery;
  }

  async getDeliveryById(id: string): Promise<Delivery> {
    const delivery = await this.deliveriesRepo.findOne({
      where: { id },
      relations: ['supplier', 'items', 'items.product'],
    });
    if (!delivery) {
      throw new NotFoundException(`Delivery with id "${id}" not found`);
    }
    return delivery;
  }

  // ── Payments ───────────────────────────────────────────────

  async getPayments(
    tenantId: string,
    supplierId?: string,
  ): Promise<SupplierPayment[]> {
    const where: FindOptionsWhere<SupplierPayment> = { tenantId };

    if (supplierId) {
      where.supplierId = supplierId;
    }

    return this.paymentsRepo.find({
      where,
      relations: ['supplier'],
      order: { date: 'DESC' },
    });
  }

  async createPayment(dto: Partial<SupplierPayment>): Promise<SupplierPayment> {
    const supplier = await this.findById(dto.supplierId);

    const payment = this.paymentsRepo.create(dto);
    const savedPayment = await this.paymentsRepo.save(payment);

    // Update supplier aggregates
    supplier.totalPaid += dto.amount;
    supplier.currentDebt -= dto.amount;
    await this.suppliersRepo.save(supplier);

    return savedPayment;
  }
}
