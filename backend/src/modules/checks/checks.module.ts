import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Check } from './entities/check.entity';
import { CheckService as CheckServiceEntity } from './entities/check-service.entity';
import { CheckProduct } from './entities/check-product.entity';
import { User } from '../users/entities/user.entity';
import { Tenant } from '../tenants/entities/tenant.entity';
import { ChecksService } from './checks.service';
import { ChecksController } from './checks.controller';
import { ProductsModule } from '../products/products.module';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Check, CheckServiceEntity, CheckProduct, User, Tenant]),
    ProductsModule,
    PdfModule,
  ],
  providers: [ChecksService],
  controllers: [ChecksController],
  exports: [ChecksService],
})
export class ChecksModule {}
