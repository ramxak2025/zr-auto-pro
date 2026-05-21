import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { WarehousesModule } from '../warehouses/warehouses.module';

@Module({
  imports: [StockMovementsModule, WarehousesModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
})
export class SuppliersModule {}
