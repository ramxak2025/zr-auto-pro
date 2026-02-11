import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateDeliveryDto } from './dto/create-delivery.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TenantId } from '../auth/decorators/tenant-id.decorator';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, TenantGuard, PermissionsGuard)
@RequirePermissions('suppliers_access')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  findAll(
    @TenantId() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.suppliersService.findAll(tenantId, { page, limit, search });
  }

  @Get(':id')
  findOne(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.suppliersService.findById(tenantId, id);
  }

  @Post()
  create(@TenantId() tenantId: string, @Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(tenantId, dto);
  }

  @Patch(':id')
  update(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(tenantId, id, dto);
  }

  @Delete(':id')
  remove(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.suppliersService.remove(tenantId, id);
  }

  @Post(':id/deliveries')
  createDelivery(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body() dto: CreateDeliveryDto,
    @CurrentUser() user: any,
  ) {
    dto.supplierId = id;
    return this.suppliersService.createDelivery(tenantId, dto, user.id);
  }

  @Get(':id/deliveries')
  getDeliveries(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.suppliersService.getDeliveries(tenantId, id, { page, limit });
  }

  @Post(':id/payments')
  createPayment(@TenantId() tenantId: string, @Param('id') id: string, @Body() dto: CreatePaymentDto) {
    dto.supplierId = id;
    return this.suppliersService.createPayment(tenantId, dto);
  }

  @Get(':id/payments')
  getPayments(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.suppliersService.getPayments(tenantId, id, { page, limit });
  }
}
