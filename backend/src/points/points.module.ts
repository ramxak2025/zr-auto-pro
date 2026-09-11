import { Module } from '@nestjs/common';
import { PointsController, AdminPointsController, UserPointsController } from './points.controller';
import { PointsService } from './points.service';

@Module({
  controllers: [PointsController, UserPointsController, AdminPointsController],
  providers: [PointsService],
})
export class PointsModule {}
