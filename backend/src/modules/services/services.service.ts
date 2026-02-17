import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, ILike } from 'typeorm';

import { ServiceEntity } from './service.entity';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(ServiceEntity)
    private readonly servicesRepo: Repository<ServiceEntity>,
  ) {}

  async findAll(
    tenantId: string,
    search?: string,
    category?: string,
  ): Promise<ServiceEntity[]> {
    const where: FindOptionsWhere<ServiceEntity> = { tenantId };

    if (search) {
      where.name = ILike(`%${search}%`);
    }

    if (category) {
      where.category = category;
    }

    return this.servicesRepo.find({
      where,
      order: { name: 'ASC' },
    });
  }

  async findById(id: string): Promise<ServiceEntity> {
    const service = await this.servicesRepo.findOne({ where: { id } });
    if (!service) {
      throw new NotFoundException(`Service with id "${id}" not found`);
    }
    return service;
  }

  async create(dto: Partial<ServiceEntity>): Promise<ServiceEntity> {
    const service = this.servicesRepo.create(dto);
    return this.servicesRepo.save(service);
  }

  async update(id: string, dto: Partial<ServiceEntity>): Promise<ServiceEntity> {
    const service = await this.servicesRepo.findOne({ where: { id } });
    if (!service) {
      throw new NotFoundException(`Service with id "${id}" not found`);
    }
    Object.assign(service, dto);
    return this.servicesRepo.save(service);
  }

  async remove(id: string): Promise<void> {
    const result = await this.servicesRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Service with id "${id}" not found`);
    }
  }
}
