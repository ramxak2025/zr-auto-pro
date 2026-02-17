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
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantsService } from './tenants.service';
import { Tenant } from './tenant.entity';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

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
  async create(@Req() req, @Body() dto: Partial<Tenant>): Promise<Tenant> {
    this.requireSuperadmin(req);
    return this.tenantsService.create(dto);
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
