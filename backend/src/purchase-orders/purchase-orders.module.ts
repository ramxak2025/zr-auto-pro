import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';

/**
 * Заказы поставщикам + приёмка. PG_POOL is provided globally by DatabaseModule
 * (@Global). StockMovementsModule is imported for its StockMovementsService —
 * receiving credits stock through the SAME income path manual receiving uses
 * (StockMovementsService.applyIncomeTx), inside the PO receive transaction.
 */
@Module({
  imports: [StockMovementsModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
