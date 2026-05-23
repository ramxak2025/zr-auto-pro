import { Module } from '@nestjs/common';
import { WarehouseAnalyticsController } from './warehouse-analytics.controller';
import { WarehouseAnalyticsService } from './warehouse-analytics.service';
import { WarehouseAnalyticsScheduler } from './warehouse-analytics.scheduler';

@Module({
  controllers: [WarehouseAnalyticsController],
  providers: [WarehouseAnalyticsService, WarehouseAnalyticsScheduler],
  exports: [WarehouseAnalyticsService],
})
export class WarehouseAnalyticsModule {}
