import { Module } from '@nestjs/common';
import { ChecksController } from './checks.controller';
import { ChecksService } from './checks.service';
import { WarrantyModule } from '../warranty/warranty.module';

@Module({
  imports: [WarrantyModule],
  controllers: [ChecksController],
  providers: [ChecksService],
})
export class ChecksModule {}
