import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.search) {
      where.name = { contains: params.search, mode: 'insensitive' };
    }
    if (params?.category) {
      where.category = params.category;
    }

    return this.prisma.product.findMany({
      where,
      include: { supplier: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async findLowStock(tenantId: string) {
    return this.prisma.product.findMany({
      where: {
        tenantId,
        stock: { lte: this.prisma.product.fields?.minStock as any },
      },
    });
  }

  async findLowStockRaw(tenantId: string) {
    return this.prisma.$queryRaw`
      SELECT * FROM products
      WHERE "tenantId" = ${tenantId} AND stock <= "minStock"
      ORDER BY name ASC
    `;
  }

  async getMovements(tenantId: string, params?: any) {
    const where: any = { tenantId };
    if (params?.productId) where.productId = params.productId;

    return this.prisma.stockMovement.findMany({
      where,
      include: { product: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { supplier: { select: { id: true, name: true } } },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return product;
  }

  async create(data: any, tenantId: string) {
    return this.prisma.product.create({
      data: {
        name: data.name,
        category: data.category,
        photo: data.photo,
        costPrice: data.costPrice || 0,
        sellPrice: data.sellPrice || 0,
        stock: data.stock || 0,
        minStock: data.minStock || 0,
        supplierId: data.supplierId || null,
        tenantId,
      },
      include: { supplier: { select: { id: true, name: true } } },
    });
  }

  async update(id: string, data: any) {
    return this.prisma.product.update({
      where: { id },
      data: {
        name: data.name,
        category: data.category,
        photo: data.photo,
        costPrice: data.costPrice,
        sellPrice: data.sellPrice,
        minStock: data.minStock,
        supplierId: data.supplierId,
      },
      include: { supplier: { select: { id: true, name: true } } },
    });
  }

  async remove(id: string) {
    await this.prisma.product.delete({ where: { id } });
    return { success: true };
  }

  async updateStock(id: string, data: any, tenantId: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Товар не найден');

    const stockBefore = product.stock;
    let stockAfter = stockBefore;

    switch (data.type) {
      case 'income':
        stockAfter = stockBefore + data.quantity;
        break;
      case 'expense':
      case 'writeoff':
        stockAfter = Math.max(0, stockBefore - data.quantity);
        break;
      case 'inventory':
        stockAfter = data.quantity;
        break;
    }

    const [updatedProduct] = await this.prisma.$transaction([
      this.prisma.product.update({
        where: { id },
        data: { stock: stockAfter },
        include: { supplier: { select: { id: true, name: true } } },
      }),
      this.prisma.stockMovement.create({
        data: {
          productId: id,
          type: data.type,
          quantity: data.quantity,
          stockBefore,
          stockAfter,
          reason: data.reason,
          tenantId,
        },
      }),
    ]);

    return updatedProduct;
  }
}
