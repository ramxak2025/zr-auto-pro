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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('suppliers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('suppliers_access')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    return this.suppliersService.findAll({ page, limit, search });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.suppliersService.findById(id);
  }

  @Post()
  create(@Body() dto: CreateSupplierDto) {
    return this.suppliersService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.suppliersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.suppliersService.remove(id);
  }

  @Post(':id/deliveries')
  createDelivery(
    @Param('id') id: string,
    @Body() dto: CreateDeliveryDto,
    @CurrentUser() user: any,
  ) {
    dto.supplierId = id;
    return this.suppliersService.createDelivery(dto, user.id);
  }

  @Get(':id/deliveries')
  getDeliveries(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.suppliersService.getDeliveries(id, { page, limit });
  }

  @Post(':id/payments')
  createPayment(@Param('id') id: string, @Body() dto: CreatePaymentDto) {
    dto.supplierId = id;
    return this.suppliersService.createPayment(dto);
  }

  @Get(':id/payments')
  getPayments(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.suppliersService.getPayments(id, { page, limit });
  }
}
