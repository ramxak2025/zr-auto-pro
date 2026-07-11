import { Module } from '@nestjs/common';
import { WarehouseController } from './warehouse.controller';
import { WarehouseService } from './warehouse.service';

@Module({
  controllers: [WarehouseController],
  providers: [WarehouseService],
  // Exported so ProductsModule can reuse the folder-cascade soft-delete
  // (softDeleteCategories) inside the bulk-delete transaction — no duplicated SQL.
  exports: [WarehouseService],
})
export class WarehouseModule {}
