import { Module } from '@nestjs/common';
import { PointsController, AdminPointsController } from './points.controller';
import { PointsService } from './points.service';

@Module({
  controllers: [PointsController, AdminPointsController],
  providers: [PointsService],
})
export class PointsModule {}
