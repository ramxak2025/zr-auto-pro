import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ClientsModule } from '../clients/clients.module';
import { ChecksModule } from '../checks/checks.module';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';
import { OneCController, OneCBridgeController } from './one-c.controller';
import { OneCService } from './one-c.service';
import { OneCDomainService } from './one-c.domain';
import { OneCKeyGuard } from './one-c.guard';
@Module({
  imports: [ProductsModule, ClientsModule, ChecksModule, PurchaseOrdersModule],
  controllers: [OneCController, OneCBridgeController],
  providers: [OneCService, OneCDomainService, OneCKeyGuard],
})
export class OneCModule {}
