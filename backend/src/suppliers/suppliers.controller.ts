import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query() query: any) {
    return this.suppliersService.findAll(user.tenantId, query);
  }

  @Get('deliveries')
  getDeliveries(@CurrentUser() user: any, @Query() query: any) {
    return this.suppliersService.getDeliveries(user.tenantId, query);
  }

  @Get('payments')
  getPayments(@CurrentUser() user: any, @Query() query: any) {
    return this.suppliersService.getPayments(user.tenantId, query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.suppliersService.findById(id);
  }

  @Post()
  create(@Body() body: any, @CurrentUser() user: any) {
    return this.suppliersService.create(body, user.tenantId);
  }

  @Post('deliveries')
  createDelivery(@Body() body: any, @CurrentUser() user: any) {
    return this.suppliersService.createDelivery(body, user.tenantId);
  }

  @Get('deliveries/:id')
  getDeliveryById(@Param('id') id: string) {
    return this.suppliersService.getDeliveryById(id);
  }

  @Post('payments')
  createPayment(@Body() body: any, @CurrentUser() user: any) {
    return this.suppliersService.createPayment(body, user.tenantId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any) {
    return this.suppliersService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.suppliersService.remove(id);
  }
}
