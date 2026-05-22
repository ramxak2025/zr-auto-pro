import { Module } from '@nestjs/common';
import { CheckPhotosController } from './check-photos.controller';
import { CheckPhotosService } from './check-photos.service';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  controllers: [CheckPhotosController],
  providers: [CheckPhotosService],
})
export class CheckPhotosModule {}
