import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Tenant, TariffPlan, TARIFF_CONFIG } from './entities/tenant.entity';
import {
  User,
  UserRole,
  DEFAULT_PERMISSIONS,
} from '../users/entities/user.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    @InjectRepository(Tenant)
    private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findAll(query: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: string;
  }): Promise<{ data: Tenant[]; total: number; page: number; limit: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const qb = this.tenantRepo
      .createQueryBuilder('tenant')
      .loadRelationCountAndMap('tenant.userCount', 'tenant.users');

    if (query.search) {
      qb.andWhere(
        '(tenant.name ILIKE :search OR tenant.slug ILIKE :search OR tenant.email ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    if (query.isActive !== undefined && query.isActive !== '') {
      const isActive = query.isActive === 'true';
      qb.andWhere('tenant.isActive = :isActive', { isActive });
    }

    qb.orderBy('tenant.createdAt', 'DESC');
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();

    return { data, total, page, limit };
  }

  async findById(id: string): Promise<Tenant> {
    const tenant = await this.tenantRepo.findOne({
      where: { id },
      relations: ['users'],
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID "${id}" not found`);
    }

    return tenant;
  }

  async create(dto: CreateTenantDto): Promise<Tenant> {
    // Check for duplicate slug if provided
    if (dto.slug) {
      const existingSlug = await this.tenantRepo.findOne({
        where: { slug: dto.slug },
      });
      if (existingSlug) {
        throw new ConflictException(
          `Tenant with slug "${dto.slug}" already exists`,
        );
      }
    }

    // Check for duplicate owner username/phone
    const existingUser = await this.userRepo.findOne({
      where: [{ username: dto.ownerUsername }, { phone: dto.ownerUsername }],
    });
    if (existingUser) {
      throw new ConflictException(
        `Пользователь с таким телефоном уже существует`,
      );
    }

    // Generate slug from name if not provided
    const slug =
      dto.slug ||
      dto.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    // Resolve tariff defaults
    const tariffPlan = dto.tariffPlan || TariffPlan.START;
    const tariffCfg = TARIFF_CONFIG[tariffPlan];
    const maxUsers = dto.maxUsers || tariffCfg.maxUsers;
    const tariffPrice = dto.tariffPrice ?? tariffCfg.price;

    // Create tenant
    const tenant = this.tenantRepo.create({
      name: dto.name,
      slug,
      phone: dto.phone,
      address: dto.address,
      email: dto.email,
      description: dto.description,
      tariffPlan,
      tariffPrice,
      maxUsers,
      subscriptionEnd: dto.subscriptionEnd
        ? new Date(dto.subscriptionEnd)
        : null,
      subscriptionNote: dto.subscriptionNote,
    });

    const savedTenant = await this.tenantRepo.save(tenant);

    // Create owner user for the tenant
    const hashedPassword = await bcrypt.hash(dto.ownerPassword, 10);
    const ownerPermissions = DEFAULT_PERMISSIONS[UserRole.DIRECTOR];

    const owner = this.userRepo.create({
      username: dto.ownerUsername,
      phone: dto.ownerUsername,
      password: hashedPassword,
      fullName: dto.ownerFullName,
      role: UserRole.DIRECTOR,
      permissions: ownerPermissions,
      tenantId: savedTenant.id,
      isActive: true,
    });

    await this.userRepo.save(owner);

    this.logger.log(
      `Created tenant "${savedTenant.name}" (${savedTenant.id}) with owner "${owner.username}"`,
    );

    // Return tenant with users relation loaded
    return this.findById(savedTenant.id);
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    const tenant = await this.findById(id);

    if (dto.slug && dto.slug !== tenant.slug) {
      const existingSlug = await this.tenantRepo.findOne({
        where: { slug: dto.slug },
      });
      if (existingSlug) {
        throw new ConflictException(
          `Tenant with slug "${dto.slug}" already exists`,
        );
      }
    }

    Object.assign(tenant, dto);

    return this.tenantRepo.save(tenant);
  }

  async activate(id: string): Promise<Tenant> {
    const tenant = await this.findById(id);
    tenant.isActive = true;
    return this.tenantRepo.save(tenant);
  }

  async deactivate(id: string): Promise<Tenant> {
    const tenant = await this.findById(id);
    tenant.isActive = false;
    return this.tenantRepo.save(tenant);
  }

  async extendSubscription(
    id: string,
    data: { subscriptionEnd: string; note?: string },
  ): Promise<Tenant> {
    const tenant = await this.findById(id);
    tenant.subscriptionEnd = new Date(data.subscriptionEnd);
    if (data.note) {
      tenant.subscriptionNote = data.note;
    }
    return this.tenantRepo.save(tenant);
  }

  async setTariff(
    id: string,
    data: { tariffPlan: TariffPlan; tariffPrice?: number; maxUsers?: number },
  ): Promise<Tenant> {
    const tenant = await this.findById(id);
    const tariffCfg = TARIFF_CONFIG[data.tariffPlan];
    tenant.tariffPlan = data.tariffPlan;
    tenant.tariffPrice = data.tariffPrice ?? tariffCfg.price;
    tenant.maxUsers = data.maxUsers || tariffCfg.maxUsers;
    this.logger.log(
      `Tenant "${tenant.name}" tariff changed to ${data.tariffPlan} (${tenant.tariffPrice} руб.)`,
    );
    return this.tenantRepo.save(tenant);
  }

  getTariffPlans() {
    return Object.entries(TARIFF_CONFIG).map(([key, cfg]) => ({
      id: key,
      ...cfg,
    }));
  }

  async remove(id: string): Promise<void> {
    const tenant = await this.findById(id);
    await this.tenantRepo.softRemove(tenant);
  }

  async getStats(): Promise<{
    totalTenants: number;
    activeTenants: number;
    totalUsers: number;
    totalChecks: number;
  }> {
    const totalTenants = await this.tenantRepo.count();
    const activeTenants = await this.tenantRepo.count({
      where: { isActive: true },
    });
    const totalUsers = await this.userRepo.count();

    // totalChecks: return 0 for now as Check repository is not injected here
    const totalChecks = 0;

    return {
      totalTenants,
      activeTenants,
      totalUsers,
      totalChecks,
    };
  }
}
