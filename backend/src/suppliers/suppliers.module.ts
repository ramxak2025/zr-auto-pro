import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { WarehousesModule } from '../warehouses/warehouses.module';

@Module({
  imports: [StockMovementsModule, WarehousesModule],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  // Exported so PurchaseOrdersModule can reuse the supplier-ledger seam
  // (recordOrderSupplyTx) when receiving an order into a supply + debt/payment.
  exports: [SuppliersService],
})
export class SuppliersModule {}
