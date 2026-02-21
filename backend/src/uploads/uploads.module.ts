import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { LocalStorageAdapter } from './storage.service';

@Module({
  controllers: [UploadsController],
  providers: [LocalStorageAdapter],
  exports: [LocalStorageAdapter],
})
export class UploadsModule {}
