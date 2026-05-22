import { Module } from '@nestjs/common';
import { CheckTemplatesController } from './check-templates.controller';
import { CheckTemplatesService } from './check-templates.service';

@Module({
  controllers: [CheckTemplatesController],
  providers: [CheckTemplatesService],
})
export class CheckTemplatesModule {}
