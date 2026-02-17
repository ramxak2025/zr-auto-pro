import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Check } from '../checks/check.entity';
import { CheckServiceLine } from '../checks/check-service-line.entity';
import { UsersModule } from '../users/users.module';
import { SalaryService } from './salary.service';
import { SalaryController } from './salary.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Check, CheckServiceLine]),
    UsersModule,
  ],
  controllers: [SalaryController],
  providers: [SalaryService],
})
export class SalaryModule {}
