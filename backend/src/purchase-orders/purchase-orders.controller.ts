import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';

/**
 * Заказы поставщикам + приёмка (purchase orders + receiving). Tenant-scoped from
 * the JWT.
 *
 * Reads (list / detail / suggestions) are open to ANY authenticated user in the
 * tenant (no @Roles ⇒ RolesGuard passes everyone) — consistent with /products
 * and /stock-movements GET, so a cashier/master can see what's on order.
 *
 * Every mutation (create / edit / order / receive / cancel) is owner-class:
 * director / admin / superadmin — the same set that may post stock movements.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private purchaseOrders: PurchaseOrdersService) {}

  // ─── Reorder suggestions — declared BEFORE :id so 'suggestions' isn't an id. ─
  @Get('suggestions')
  suggestions(@CurrentUser() user: JwtPayload) {
    return this.purchaseOrders.suggestions(user.tenantID);
  }

  // ─── List ──────────────────────────────────────────────────────────────
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: { status?: string; supplierId?: string; page?: string; limit?: string },
  ) {
    return this.purchaseOrders.list(user.tenantID, query);
  }

  // ─── Detail ────────────────────────────────────────────────────────────
  @Get(':id')
  getById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.purchaseOrders.getById(id, user.tenantID);
  }

  // ─── Create (draft) ────────────────────────────────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrders.create(user.tenantID, user.userID, dto);
  }

  // ─── Edit (draft only) ─────────────────────────────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto) {
    return this.purchaseOrders.update(id, user.tenantID, dto);
  }

  // ─── Order (draft → ordered) ───────────────────────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Post(':id/order')
  order(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.purchaseOrders.markOrdered(id, user.tenantID);
  }

  // ─── Receive (full or partial) ─────────────────────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Post(':id/receive')
  receive(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ReceivePurchaseOrderDto) {
    return this.purchaseOrders.receive(id, user.tenantID, user.userID, dto);
  }

  // ─── Cancel (not yet received) ─────────────────────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Post(':id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.purchaseOrders.cancel(id, user.tenantID);
  }
}
