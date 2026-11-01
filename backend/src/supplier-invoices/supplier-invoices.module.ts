import { Module } from '@nestjs/common';
import { UploadsModule } from '../uploads/uploads.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { SupplierInvoicesService } from './supplier-invoices.service';
import { SupplierInvoicesController } from './supplier-invoices.controller';
import { YandexInvoiceOcr } from './yandex-invoice-ocr';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module';

@Module({
  imports: [UploadsModule, SuppliersModule, PurchaseOrdersModule],
  controllers: [SupplierInvoicesController],
  providers: [SupplierInvoicesService, YandexInvoiceOcr],
})
export class SupplierInvoicesModule {}
