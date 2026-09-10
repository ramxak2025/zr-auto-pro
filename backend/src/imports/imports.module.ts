import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { ClientsModule } from '../clients/clients.module';

@Module({
  // ClientsModule — ради ClientsService.separatePointFor / separatePointWhere
  // (161): импорт обязан подчиняться тем же границам филиала, что и база
  // клиентов, иначе он становится способом её обойти.
  imports: [ClientsModule],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
