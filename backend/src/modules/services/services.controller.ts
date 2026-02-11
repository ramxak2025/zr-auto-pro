import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { TenantId } from '../auth/decorators/tenant-id.decorator';

@Controller('services')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.servicesService.findAll(tenantId, { page, limit, search, category });
  }

  @Get('categories')
  getCategories(@TenantId() tenantId: string) {
    return this.servicesService.getCategories(tenantId);
  }

  @Get(':id')
  findById(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.servicesService.findById(tenantId, id);
  }

  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermissions('warehouse_access')
  create(@TenantId() tenantId: string, @Body() dto: CreateServiceDto) {
    return this.servicesService.create(tenantId, dto);
  }

  @Patch(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('warehouse_access')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.servicesService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @UseGuards(PermissionsGuard)
  @RequirePermissions('warehouse_access')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.servicesService.remove(tenantId, id);
  }
}
