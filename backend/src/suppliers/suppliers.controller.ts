import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.suppliersService.getAll(user.tenantID, query);
  }

  @Get('deliveries')
  getDeliveries(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.suppliersService.getDeliveries(user.tenantID, query);
  }

  @Get('payments')
  getPayments(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.suppliersService.getPayments(user.tenantID, query);
  }

  @Get('deliveries/:id')
  getDeliveryById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.suppliersService.getDeliveryById(id, user.tenantID);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.suppliersService.getById(id, user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.suppliersService.create(user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('deliveries')
  createDelivery(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.suppliersService.createDelivery(user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post('payments')
  createPayment(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.suppliersService.createPayment(user.tenantID, dto);
  }

  // Defect return-to-supplier. Decrements defect-warehouse stock, lowers the
  // supplier's outstanding debt, and logs a stock_movement of type
  // defect_return_to_supplier. Director / admin / superadmin only.
  @Roles('director', 'admin', 'superadmin')
  @Post(':id/return-defect')
  returnDefect(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { productId: string; qty: number; purchasePrice?: number; note?: string },
  ) {
    return this.suppliersService.returnDefect(user.tenantID, user.userID, id, dto);
  }

  // Used-purchase: buy a second-hand item from a client through the
  // pinned "Покупка б/у товара" system supplier. Auto-creates (or
  // increments) the matching product on the Б/У warehouse, logs the
  // delivery + supplier debt, and writes a stock_movement marked with
  // is_used_purchase=true for journal rendering.
  @Roles('director', 'admin', 'superadmin')
  @Post(':id/used-purchase')
  usedPurchase(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { productName: string; qty: number; purchasePrice: number; category?: string; note?: string },
  ) {
    return this.suppliersService.usedPurchase(user.tenantID, user.userID, id, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.suppliersService.update(id, user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.suppliersService.remove(id, user.tenantID);
  }
}
