import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { Delivery } from './entities/delivery.entity';
import { DeliveryItem } from './entities/delivery-item.entity';
import { SupplierPayment } from './entities/supplier-payment.entity';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Supplier, Delivery, DeliveryItem, SupplierPayment]),
    ProductsModule,
  ],
  providers: [SuppliersService],
  controllers: [SuppliersController],
  exports: [SuppliersService],
})
export class SuppliersModule {}
