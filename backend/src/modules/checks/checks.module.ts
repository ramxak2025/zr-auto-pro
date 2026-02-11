import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Check } from './entities/check.entity';
import { CheckService as CheckServiceEntity } from './entities/check-service.entity';
import { CheckProduct } from './entities/check-product.entity';
import { User } from '../users/entities/user.entity';
import { ChecksService } from './checks.service';
import { ChecksController } from './checks.controller';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Check, CheckServiceEntity, CheckProduct, User]),
    ProductsModule,
  ],
  providers: [ChecksService],
  controllers: [ChecksController],
  exports: [ChecksService],
})
export class ChecksModule {}
