import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Check } from './entities/check.entity';
import { CheckService as CheckServiceEntity } from './entities/check-service.entity';
import { CheckProduct } from './entities/check-product.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { ProductsService } from '../products/products.service';
import { MovementType } from '../products/entities/stock-movement.entity';
import { CreateCheckDto } from './dto/create-check.dto';
import { UpdateCheckDto } from './dto/update-check.dto';

@Injectable()
export class ChecksService {
  constructor(
    @InjectRepository(Check)
    private checkRepo: Repository<Check>,
    @InjectRepository(CheckServiceEntity)
    private checkServiceRepo: Repository<CheckServiceEntity>,
    @InjectRepository(CheckProduct)
    private checkProductRepo: Repository<CheckProduct>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(Tenant)
    private tenantRepo: Repository<Tenant>,
    private productsService: ProductsService,
  ) {}

  async findAll(tenantId: string, query: {
    page?: number;
    limit?: number;
    masterId?: string;
    clientId?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 20;

    const qb = this.checkRepo
      .createQueryBuilder('check')
      .leftJoinAndSelect('check.master', 'master')
      .leftJoinAndSelect('check.client', 'client')
      .leftJoinAndSelect('check.car', 'car')
      .leftJoinAndSelect('check.services', 'services')
      .leftJoinAndSelect('check.products', 'products')
      .where('check.deletedAt IS NULL')
      .andWhere('check.tenantId = :tenantId', { tenantId });

    if (query.masterId) {
      qb.andWhere('check.masterId = :masterId', { masterId: query.masterId });
    }
    if (query.clientId) {
      qb.andWhere('check.clientId = :clientId', { clientId: query.clientId });
    }
    if (query.dateFrom) {
      qb.andWhere('check.date >= :dateFrom', { dateFrom: query.dateFrom });
    }
    if (query.dateTo) {
      qb.andWhere('check.date <= :dateTo', { dateTo: query.dateTo });
    }

    qb.orderBy('check.date', 'DESC');

    const total = await qb.getCount();
    const data = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return { data, total, page, limit };
  }

  async findById(tenantId: string, id: string) {
    const check = await this.checkRepo.findOne({
      where: { id, tenantId },
      relations: ['master', 'client', 'car', 'services', 'products'],
    });
    if (!check) throw new NotFoundException('Check not found');
    return check;
  }

  async create(tenantId: string, dto: CreateCheckDto, userId: string) {
    const master = await this.userRepo.findOne({ where: { id: dto.masterId, tenantId } });
    if (!master) throw new NotFoundException('Master not found');

    const serviceLines: CheckServiceEntity[] = (dto.services || []).map((s) => {
      const line = new CheckServiceEntity();
      line.serviceId = s.serviceId || null as any;
      line.name = s.name;
      line.price = s.price;
      line.quantity = s.quantity;
      line.total = s.price * s.quantity;
      return line;
    });

    const productLines: CheckProduct[] = (dto.products || []).map((p) => {
      const line = new CheckProduct();
      line.productId = p.productId;
      line.name = p.name;
      line.sellPrice = p.sellPrice;
      line.costPrice = p.costPrice;
      line.quantity = p.quantity;
      line.totalSell = p.sellPrice * p.quantity;
      line.totalCost = p.costPrice * p.quantity;
      return line;
    });

    const serviceTotal = serviceLines.reduce((sum, s) => sum + Number(s.total), 0);
    const productTotal = productLines.reduce((sum, p) => sum + Number(p.totalSell), 0);
    const totalRevenue = serviceTotal + productTotal;
    const productCostTotal = productLines.reduce((sum, p) => sum + Number(p.totalCost), 0);
    const serviceSalaryTotal = serviceTotal * (Number(master.salaryPercent) / 100);
    const totalCost = productCostTotal + serviceSalaryTotal;
    const profit = totalRevenue - totalCost;

    // Auto-generate check number per tenant
    const lastCheck = await this.checkRepo
      .createQueryBuilder('check')
      .where('check.tenantId = :tenantId', { tenantId })
      .orderBy('check.number', 'DESC', 'NULLS LAST')
      .getOne();
    const nextNumber = (lastCheck?.number || 0) + 1;

    const check = this.checkRepo.create({
      tenantId,
      number: nextNumber,
      masterId: dto.masterId,
      clientId: dto.clientId,
      carId: dto.carId,
      mileage: dto.mileage,
      comment: dto.comment,
      paymentMethod: dto.paymentMethod,
      date: dto.date ? new Date(dto.date) : new Date(),
      isDeferred: dto.isDeferred || false,
      discount: dto.discount || 0,
      services: serviceLines,
      products: productLines,
      serviceTotal,
      productTotal,
      totalRevenue,
      productCostTotal,
      serviceSalaryTotal,
      totalCost,
      profit,
    });

    const saved = await this.checkRepo.save(check);

    // Deduct stock for each product
    for (const p of dto.products || []) {
      try {
        await this.productsService.adjustStock(
          tenantId,
          p.productId,
          p.quantity,
          MovementType.EXPENSE,
          userId,
          `Чек #${saved.number || saved.id}`,
          saved.id,
        );
      } catch (e) {
        // continue even if stock adjustment fails
      }
    }

    return this.findById(tenantId, saved.id);
  }

  async update(tenantId: string, id: string, dto: UpdateCheckDto) {
    const check = await this.findById(tenantId, id);
    Object.assign(check, dto);
    return this.checkRepo.save(check);
  }

  async remove(tenantId: string, id: string) {
    const check = await this.findById(tenantId, id);
    return this.checkRepo.softRemove(check);
  }

  async getTenantName(tenantId: string): Promise<string> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return tenant?.name || 'Автосервис';
  }
}
