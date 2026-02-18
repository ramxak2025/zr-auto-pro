import { Module } from '@nestjs/common';
import { ServicesController } from './services.controller';
import { ServicesAppService } from './services.service';

@Module({
  controllers: [ServicesController],
  providers: [ServicesAppService],
  exports: [ServicesAppService],
})
export class ServicesModule {}
