import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Check } from './check.entity';
import { CheckServiceLine } from './check-service-line.entity';
import { CheckProductLine } from './check-product-line.entity';
import { ChecksService } from './checks.service';
import { ChecksController } from './checks.controller';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Check, CheckServiceLine, CheckProductLine]),
    ProductsModule,
  ],
  controllers: [ChecksController],
  providers: [ChecksService],
  exports: [ChecksService],
})
export class ChecksModule {}
