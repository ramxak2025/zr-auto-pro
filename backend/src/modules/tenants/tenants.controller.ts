import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantsService } from './tenants.service';
import { UsersService } from '../users/users.service';
import { Tenant } from './tenant.entity';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  private readonly logger = new Logger(TenantsController.name);

  constructor(
    private readonly tenantsService: TenantsService,
    private readonly usersService: UsersService,
  ) {}

  @Get()
  async findAll(@Req() req): Promise<Tenant[]> {
    this.requireSuperadmin(req);
    return this.tenantsService.findAll();
  }

  @Get('stats')
  async getStats(
    @Req() req,
  ): Promise<{ totalTenants: number; activeTenants: number; totalUsers: number }> {
    this.requireSuperadmin(req);
    return this.tenantsService.getStats();
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<Tenant> {
    return this.tenantsService.findById(id);
  }

  @Post()
  async create(
    @Req() req,
    @Body()
    dto: Partial<Tenant> & {
      directorName?: string;
      directorPhone?: string;
      directorPassword?: string;
    },
  ): Promise<Tenant> {
    this.requireSuperadmin(req);

    const { directorName, directorPhone, directorPassword, ...tenantDto } = dto;

    const tenant = await this.tenantsService.create(tenantDto);

    // Auto-create director user for the new tenant
    if (directorPhone && directorPassword) {
      try {
        await this.usersService.create({
          phone: directorPhone,
          password: directorPassword,
          fullName: directorName || 'Директор',
          role: 'director',
          tenantId: tenant.id,
          permissions: {
            manageUsers: true,
            manageClients: true,
            manageCars: true,
            manageProducts: true,
            manageServices: true,
            manageChecks: true,
            manageSuppliers: true,
            manageSalary: true,
            manageSchedule: true,
            manageShifts: true,
            viewReports: true,
          },
          isActive: true,
        } as any);
        this.logger.log(`Director created for tenant "${tenant.name}" with phone "${directorPhone}"`);
      } catch (error) {
        this.logger.error(`Failed to create director: ${error.message}`);
      }
    }

    return this.tenantsService.findById(tenant.id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: Partial<Tenant>,
  ): Promise<Tenant> {
    return this.tenantsService.update(id, dto);
  }

  @Delete(':id')
  async remove(@Req() req, @Param('id') id: string): Promise<void> {
    this.requireSuperadmin(req);
    return this.tenantsService.remove(id);
  }

  private requireSuperadmin(req): void {
    if (req.user?.role !== 'superadmin') {
      throw new ForbiddenException('Only superadmin can perform this action');
    }
  }
}
