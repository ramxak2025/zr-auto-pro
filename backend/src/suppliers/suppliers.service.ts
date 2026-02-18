import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.search) {
      where.name = { contains: params.search, mode: 'insensitive' };
    }
    return this.prisma.supplier.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: {
        deliveries: {
          include: { items: { include: { product: { select: { id: true, name: true } } } } },
          orderBy: { date: 'desc' },
        },
        payments: { orderBy: { date: 'desc' } },
        products: { select: { id: true, name: true, stock: true } },
      },
    });
    if (!supplier) throw new NotFoundException('Поставщик не найден');
    return supplier;
  }

  async create(data: any, tenantId: string) {
    return this.prisma.supplier.create({
      data: {
        name: data.name,
        phone: data.phone,
        contactPerson: data.contactPerson,
        comment: data.comment,
        tenantId,
      },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.supplier.update({
      where: { id },
      data: {
        name: data.name,
        phone: data.phone,
        contactPerson: data.contactPerson,
        comment: data.comment,
      },
    });
  }

  async remove(id: string) {
    await this.prisma.supplier.delete({ where: { id } });
    return { success: true };
  }

  // Deliveries
  async getDeliveries(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.supplierId) where.supplierId = params.supplierId;

    return this.prisma.delivery.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true } } } },
      },
      orderBy: { date: 'desc' },
    });
  }

  async createDelivery(data: any, tenantId: string) {
    const totalAmount = (data.items || []).reduce(
      (s: number, i: any) => s + (i.total || i.price * i.quantity),
      0,
    );

    const delivery = await this.prisma.delivery.create({
      data: {
        supplierId: data.supplierId,
        date: data.date ? new Date(data.date) : new Date(),
        totalAmount,
        paymentStatus: data.paymentStatus || 'unpaid',
        comment: data.comment,
        tenantId,
        items: {
          create: (data.items || []).map((item: any) => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
            total: item.total || item.price * item.quantity,
          })),
        },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });

    // Update supplier totalPurchases and debt
    await this.prisma.supplier.update({
      where: { id: data.supplierId },
      data: {
        totalPurchases: { increment: totalAmount },
        currentDebt: { increment: totalAmount },
      },
    });

    // Update product stock
    for (const item of data.items || []) {
      if (item.productId) {
        const product = await this.prisma.product.findUnique({ where: { id: item.productId } });
        if (product) {
          const stockBefore = product.stock;
          const stockAfter = stockBefore + item.quantity;
          await this.prisma.product.update({
            where: { id: item.productId },
            data: { stock: stockAfter },
          });
          await this.prisma.stockMovement.create({
            data: {
              productId: item.productId,
              type: 'income',
              quantity: item.quantity,
              stockBefore,
              stockAfter,
              reason: `Поставка от ${delivery.supplier?.name || 'поставщика'}`,
              tenantId,
            },
          });
        }
      }
    }

    return delivery;
  }

  async getDeliveryById(id: string) {
    const delivery = await this.prisma.delivery.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    if (!delivery) throw new NotFoundException('Поставка не найдена');
    return delivery;
  }

  // Payments
  async getPayments(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.supplierId) where.supplierId = params.supplierId;

    return this.prisma.supplierPayment.findMany({
      where,
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
    });
  }

  async createPayment(data: any, tenantId: string) {
    const payment = await this.prisma.supplierPayment.create({
      data: {
        supplierId: data.supplierId,
        amount: data.amount,
        date: data.date ? new Date(data.date) : new Date(),
        comment: data.comment,
        tenantId,
      },
      include: { supplier: { select: { id: true, name: true } } },
    });

    // Update supplier totals
    await this.prisma.supplier.update({
      where: { id: data.supplierId },
      data: {
        totalPaid: { increment: data.amount },
        currentDebt: { decrement: data.amount },
      },
    });

    return payment;
  }
}
