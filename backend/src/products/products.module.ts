import { PublicProductsController } from './public-products.controller';
import { ProductSharingService } from './product-sharing.service';
import { UsedIntakeService } from './used-intake.service';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { WarehousesModule } from '../warehouses/warehouses.module';
import { UploadsModule } from '../uploads/uploads.module';
import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { WarehouseModule } from '../warehouse/warehouse.module';

@Module({
  // WarehouseModule is imported so ProductsService can reuse
  // WarehouseService.softDeleteCategories in the bulk-delete transaction.
  imports: [WarehouseModule, StockMovementsModule, WarehousesModule, UploadsModule],
  controllers: [ProductsController, PublicProductsController],
  providers: [ProductsService, ProductSharingService, UsedIntakeService],
  exports: [ProductsService],
})
export class ProductsModule {}
