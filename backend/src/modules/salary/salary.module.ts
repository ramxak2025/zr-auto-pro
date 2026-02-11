import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Check } from '../checks/entities/check.entity';
import { User } from '../users/entities/user.entity';
import { SalaryService } from './salary.service';
import { SalaryController } from './salary.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Check, User])],
  controllers: [SalaryController],
  providers: [SalaryService],
  exports: [SalaryService],
})
export class SalaryModule {}
