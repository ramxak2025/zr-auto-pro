import { Module } from '@nestjs/common';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from './purchase-orders.service';
import { StockMovementsModule } from '../stock-movements/stock-movements.module';
import { SuppliersModule } from '../suppliers/suppliers.module';

/**
 * Заказы поставщикам + приёмка. PG_POOL is provided globally by DatabaseModule
 * (@Global).
 *
 *   • StockMovementsModule → StockMovementsService.applyIncomeTx credits stock
 *     through the SAME income path manual receiving uses.
 *   • SuppliersModule → SuppliersService.recordOrderSupplyTx writes the supply
 *     (deliveries row) + supplier debt / auto-payment.
 *
 * Both run INSIDE the single PO receive transaction, so stock + supply + debt /
 * payment commit or roll back together. No import cycle: SuppliersModule depends
 * only on StockMovements + Warehouses, never on PurchaseOrders.
 */
@Module({
  imports: [StockMovementsModule, SuppliersModule],
  controllers: [PurchaseOrdersController],
  providers: [PurchaseOrdersService],
})
export class PurchaseOrdersModule {}
