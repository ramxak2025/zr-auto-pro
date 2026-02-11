import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { CarsService } from './cars.service';
import { CreateCarDto } from './dto/create-car.dto';
import { UpdateCarDto } from './dto/update-car.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { TenantId } from '../auth/decorators/tenant-id.decorator';

@Controller('cars')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
export class CarsController {
  constructor(private readonly carsService: CarsService) {}

  @Get()
  @RequirePermissions('clients_view')
  findAll(
    @TenantId() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.carsService.findAll(tenantId, { page, limit, search, clientId });
  }

  @Get(':id')
  @RequirePermissions('clients_view')
  findOne(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.carsService.findById(tenantId, id);
  }

  @Post()
  @RequirePermissions('clients_edit')
  create(@TenantId() tenantId: string, @Body() dto: CreateCarDto) {
    return this.carsService.create(tenantId, dto);
  }

  @Patch(':id')
  @RequirePermissions('clients_edit')
  update(
    @TenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCarDto,
  ) {
    return this.carsService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @RequirePermissions('clients_edit')
  remove(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.carsService.remove(tenantId, id);
  }
}
