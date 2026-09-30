import { Module } from '@nestjs/common';
import { StorageCellsController } from './storage-cells.controller';
import { StorageCellsService } from './storage-cells.service';
import { WarehousesModule } from '../warehouses/warehouses.module';

@Module({
  imports: [WarehousesModule],
  controllers: [StorageCellsController],
  providers: [StorageCellsService],
  exports: [StorageCellsService],
})
export class StorageCellsModule {}
