import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Service } from './entities/service.entity';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly repo: Repository<Service>,
  ) {}

  async findAll(tenantId: string, query: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
  }): Promise<{ data: Service[]; total: number; page: number; limit: number }> {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (query.search) {
      where.name = ILike(`%${query.search}%`);
    }

    if (query.category) {
      where.category = query.category;
    }

    const [data, total] = await this.repo.findAndCount({
      where,
      skip,
      take: limit,
      order: { createdAt: 'DESC' },
    });

    return { data, total, page, limit };
  }

  async findById(tenantId: string, id: string): Promise<Service> {
    const service = await this.repo.findOne({ where: { id, tenantId } });

    if (!service) {
      throw new NotFoundException(`Service with ID "${id}" not found`);
    }

    return service;
  }

  async create(tenantId: string, dto: CreateServiceDto): Promise<Service> {
    const service = this.repo.create({ ...dto, tenantId });
    return this.repo.save(service);
  }

  async update(tenantId: string, id: string, dto: UpdateServiceDto): Promise<Service> {
    const service = await this.findById(tenantId, id);
    Object.assign(service, dto);
    return this.repo.save(service);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const service = await this.findById(tenantId, id);
    await this.repo.softRemove(service);
  }

  async getCategories(tenantId: string): Promise<string[]> {
    const results = await this.repo
      .createQueryBuilder('service')
      .select('DISTINCT service.category', 'category')
      .where('service.tenantId = :tenantId', { tenantId })
      .andWhere('service.category IS NOT NULL')
      .andWhere('service.deletedAt IS NULL')
      .orderBy('service.category', 'ASC')
      .getRawMany();

    return results.map((r) => r.category);
  }
}
