import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { ChangePurchaseOrderDateDto } from './dto/change-purchase-order-date.dto';

/**
 * Заказы поставщикам + приёмка (purchase orders + receiving). Tenant-scoped from
 * the JWT.
 *
 * ROLE-ONLY (консолидация 2026-07). Часть контура «Поставщики» — гейтится теми
 * же ключами:
 *   • view   — list / detail / suggestions → 'suppliers_access';
 *   • manage — create / edit / order / receive / date / cancel → 'suppliers_manage'.
 * Owner-class (director/admin/superadmin) обходит гейты через PermissionsGuard.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private purchaseOrders: PurchaseOrdersService) {}

  // ─── Reorder suggestions — declared BEFORE :id so 'suggestions' isn't an id. ─
  @RequirePermission('suppliers_access')
  @Get('suggestions')
  suggestions(@CurrentUser() user: JwtPayload) {
    return this.purchaseOrders.suggestions(user.tenantID);
  }

  // ─── List ──────────────────────────────────────────────────────────────
  @RequirePermission('suppliers_access')
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: { status?: string; supplierId?: string; page?: string; limit?: string },
  ) {
    return this.purchaseOrders.list(user.tenantID, query);
  }

  // ─── Detail ────────────────────────────────────────────────────────────
  @RequirePermission('suppliers_access')
  @Get(':id')
  getById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.purchaseOrders.getById(id, user.tenantID);
  }

  // ─── Create (draft) ────────────────────────────────────────────────────
  @RequirePermission('suppliers_manage')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrders.create(user.tenantID, user.userID, dto);
  }

  // ─── Edit (draft only) ─────────────────────────────────────────────────
  @RequirePermission('suppliers_manage')
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto) {
    return this.purchaseOrders.update(id, user.tenantID, dto);
  }

  // ─── Order (draft → ordered) ───────────────────────────────────────────
  @RequirePermission('suppliers_manage')
  @Post(':id/order')
  order(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.purchaseOrders.markOrdered(id, user.tenantID);
  }

  // ─── Receive (full or partial) ─────────────────────────────────────────
  @RequirePermission('suppliers_manage')
  @Post(':id/receive')
  receive(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ReceivePurchaseOrderDto) {
    return this.purchaseOrders.receive(id, user.tenantID, user.userID, dto);
  }

  // ─── Смена даты проведённой поставки (159) ─────────────────────────────
  // Гейт — тот же 'suppliers_manage', что у приёмки и у корректировки поставки
  // PATCH /suppliers/deliveries/:id (она уже умеет менять дату накладной).
  // Отдельного права не заводим: одна операция не должна гейтиться строже
  // соседней ручки, которая делает то же самое с той же накладной.
  // Путь ':id/date' — отдельный сегмент, с @Patch(':id') не конфликтует.
  @RequirePermission('suppliers_manage')
  @Patch(':id/date')
  changeDate(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ChangePurchaseOrderDateDto) {
    return this.purchaseOrders.changeReceivedDate(id, user.tenantID, user.userID, dto);
  }

  // ─── Cancel (not yet received) ─────────────────────────────────────────
  @RequirePermission('suppliers_manage')
  @Post(':id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.purchaseOrders.cancel(id, user.tenantID);
  }
}
