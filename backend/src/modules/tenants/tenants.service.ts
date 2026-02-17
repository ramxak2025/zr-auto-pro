import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from './tenant.entity';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
  ) {}

  async findAll(): Promise<Tenant[]> {
    return this.tenantRepo.find({
      relations: ['users'],
      order: { createdAt: 'DESC' },
    });
  }

  async findById(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({
      where: { id },
      relations: ['users'],
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant with id "${id}" not found`);
    }
    return tenant;
  }

  async create(dto: Partial<Tenant>): Promise<Tenant> {
    const slug = this.generateSlug(dto.name!);
    const tenant = this.tenantRepo.create({ ...dto, slug });
    return this.tenantRepo.save(tenant);
  }

  async update(id: string, dto: Partial<Tenant>): Promise<Tenant> {
    const tenant = await this.findById(id);
    if (dto.name && dto.name !== tenant.name) {
      dto.slug = this.generateSlug(dto.name);
    }
    Object.assign(tenant, dto);
    return this.tenantRepo.save(tenant);
  }

  async remove(id: string): Promise<void> {
    const tenant = await this.findById(id);
    await this.tenantRepo.remove(tenant);
  }

  async getStats(): Promise<{
    totalTenants: number;
    activeTenants: number;
    totalUsers: number;
  }> {
    const tenants = await this.tenantRepo.find({ relations: ['users'] });
    const totalTenants = tenants.length;
    const activeTenants = tenants.filter((t) => t.isActive).length;
    const totalUsers = tenants.reduce(
      (sum, t) => sum + (t.users ? t.users.length : 0),
      0,
    );
    return { totalTenants, activeTenants, totalUsers };
  }

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s]+/g, '-')
      .replace(/-+/g, '-');
  }
}
