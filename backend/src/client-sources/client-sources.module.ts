import { Module } from '@nestjs/common';
import { ClientSourcesController } from './client-sources.controller';
import { ClientSourcesService } from './client-sources.service';

@Module({
  controllers: [ClientSourcesController],
  providers: [ClientSourcesService],
  exports: [ClientSourcesService],
})
export class ClientSourcesModule {}
