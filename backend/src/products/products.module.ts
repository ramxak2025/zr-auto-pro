import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { WarehouseModule } from '../warehouse/warehouse.module';

@Module({
  // WarehouseModule is imported so ProductsService can reuse
  // WarehouseService.softDeleteCategories in the bulk-delete transaction.
  imports: [WarehouseModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
