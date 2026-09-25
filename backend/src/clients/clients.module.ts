import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { VinModule } from '../vin/vin.module';

@Module({
  // VinModule (171) — поиск клиента по VIN его машин включается опцией тенанта
  // (VinService.isEnabled). Обратной зависимости нет: VinModule ничего не
  // импортирует.
  imports: [VinModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  // 161 — CarsService переиспользует separatePointFor / separatePointWhere:
  // «на каком филиале виден клиент» обязано решаться ОДНИМ кодом. Вторая копия
  // логики разъехалась бы, и гараж отдавал бы то, что база клиентов прячет.
  exports: [ClientsService],
})
export class ClientsModule {}
