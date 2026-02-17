import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Check } from '../checks/check.entity';
import { ReportsService } from './reports.service';
import { ReportsController } from './reports.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Check])],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
