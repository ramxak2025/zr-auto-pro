import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService],
  // 161 — CarsService переиспользует separatePointFor / separatePointWhere:
  // «на каком филиале виден клиент» обязано решаться ОДНИМ кодом. Вторая копия
  // логики разъехалась бы, и гараж отдавал бы то, что база клиентов прячет.
  exports: [ClientsService],
})
export class ClientsModule {}
