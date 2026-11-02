import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { ProductKitsController } from './product-kits.controller';
import { ProductKitsService } from './product-kits.service';
@Module({
  imports: [ProductsModule],
  controllers: [ProductKitsController],
  providers: [ProductKitsService],
  exports: [ProductKitsService],
})
export class ProductKitsModule {}
