import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Check } from '../checks/entities/check.entity';
import { CheckService } from '../checks/entities/check-service.entity';
import { CheckProduct } from '../checks/entities/check-product.entity';
import { User } from '../users/entities/user.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Check, CheckService, CheckProduct, User]),
  ],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
