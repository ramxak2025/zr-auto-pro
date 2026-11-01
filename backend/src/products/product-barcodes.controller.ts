import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { ProductBarcodesService } from './product-barcodes.service';

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('products')
export class ProductBarcodesController {
  constructor(private readonly barcodes: ProductBarcodesService) {}

  @Get('lookup-barcode')
  lookup(
    @CurrentUser() user: JwtPayload,
    @Query() query: { barcode?: string; warehouseId?: string; page?: string; limit?: string },
  ) {
    return this.barcodes.lookup(user.tenantID, query, user);
  }

  @RequirePermission('warehouse_manage')
  @Post('internal-barcodes')
  generateBatch(@CurrentUser() user: JwtPayload, @Body() body: { productIds?: unknown }) {
    return this.barcodes.generate(user.tenantID, body?.productIds, user);
  }

  @RequirePermission('warehouse_manage')
  @Post(':id/internal-barcode')
  async generateOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return (await this.barcodes.generate(user.tenantID, [id], user)).products[0];
  }
}
