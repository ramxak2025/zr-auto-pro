import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ClientVersionController } from './client-version.controller';

@Module({
  // ClientVersionController живёт в health-модуле сознательно: оба —
  // публичные (без JWT) инфраструктурные эндпоинты с одинаковым паттерном
  // «без guard'ов на контроллере».
  controllers: [HealthController, ClientVersionController],
})
export class HealthModule {}
