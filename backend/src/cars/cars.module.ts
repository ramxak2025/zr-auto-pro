import { Module } from '@nestjs/common';
import { CarsController } from './cars.controller';
import { CarsService } from './cars.service';
import { ClientsModule } from '../clients/clients.module';

@Module({
  // ClientsModule — ради ClientsService.separatePointFor / separatePointWhere
  // (161): раздельная база клиентов режет и гараж, и правило видимости у них
  // обязано быть одно на двоих.
  imports: [ClientsModule],
  controllers: [CarsController],
  providers: [CarsService],
})
export class CarsModule {}
