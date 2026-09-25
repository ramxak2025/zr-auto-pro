import { Module } from '@nestjs/common';
import { VinController } from './vin.controller';
import { VinService } from './vin.service';

/**
 * VIN (171). PG_POOL приходит из глобального DatabaseModule — импортов нет.
 * VinService экспортируется: CarsModule и ClientsModule спрашивают у него
 * «включена ли опция у тенанта» (isEnabled) и нормализуют VIN тем же кодом.
 * Обратной зависимости нет — VinModule ничего не знает о машинах и клиентах.
 */
@Module({
  controllers: [VinController],
  providers: [VinService],
  exports: [VinService],
})
export class VinModule {}
