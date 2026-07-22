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
  ForbiddenException,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission, userHasPermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// ROLE-ONLY (консолидация 2026-07). Enforcement на сервере:
//   • view   — список/детали поставщиков, поставок, оплат → 'suppliers_access';
//   • manage — create/update/delete + поставки/оплаты/возвраты/б-у → 'suppliers_manage'.
// Owner-class (director/admin/superadmin) обходит гейты через PermissionsGuard.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('suppliers')
export class SuppliersController {
  constructor(private suppliersService: SuppliersService) {}

  @RequirePermission('suppliers_access')
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.suppliersService.getAll(user.tenantID, query);
  }

  @RequirePermission('suppliers_access')
  @Get('deliveries')
  getDeliveries(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.suppliersService.getDeliveries(user.tenantID, query);
  }

  @RequirePermission('suppliers_access')
  @Get('payments')
  getPayments(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.suppliersService.getPayments(user.tenantID, query);
  }

  // Отчёт по оплатам поставщикам за период — для секции «Закупка товара (не
  // влияет на прибыль)» в разделе «Расходы» (волна G). Гейт как у GET /expenses:
  // OR-проверка can_add_expenses | financial_reports (вносящий видит контекст
  // затрат, финансист — тоже; owner-class проходит через userHasPermission).
  // Литеральный путь объявлен ДО @Get(':id'), иначе 'payments-report' попал бы
  // в параметр :id.
  @Get('payments-report')
  getPaymentsReport(@CurrentUser() user: JwtPayload, @Query() query: any) {
    if (!userHasPermission(user, 'can_add_expenses') && !userHasPermission(user, 'financial_reports')) {
      throw new ForbiddenException({ message: 'Недостаточно прав для этого действия' });
    }
    return this.suppliersService.getPaymentsReport(user.tenantID, query);
  }

  @RequirePermission('suppliers_access')
  @Get('deliveries/:id')
  getDeliveryById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.suppliersService.getDeliveryById(id, user.tenantID);
  }

  @RequirePermission('suppliers_access')
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.suppliersService.getById(id, user.tenantID);
  }

  @RequirePermission('suppliers_manage')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.suppliersService.create(user.tenantID, dto);
  }

  @RequirePermission('suppliers_manage')
  @Post('deliveries')
  createDelivery(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.suppliersService.createDelivery(user.tenantID, dto);
  }

  @RequirePermission('suppliers_manage')
  @Post('payments')
  createPayment(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.suppliersService.createPayment(user.tenantID, dto);
  }

  // Defect return-to-supplier. Decrements defect-warehouse stock, lowers the
  // supplier's outstanding debt, and logs a stock_movement of type
  // defect_return_to_supplier.
  @RequirePermission('suppliers_manage')
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
  @RequirePermission('suppliers_manage')
  @Post(':id/used-purchase')
  usedPurchase(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { productName: string; qty: number; purchasePrice: number; category?: string; note?: string },
  ) {
    return this.suppliersService.usedPurchase(user.tenantID, user.userID, id, dto);
  }

  @RequirePermission('suppliers_manage')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.suppliersService.update(id, user.tenantID, dto);
  }

  @RequirePermission('suppliers_manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.suppliersService.remove(id, user.tenantID);
  }
}
