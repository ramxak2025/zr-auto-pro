import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { TenantsModule } from '../tenants/tenants.module';
import { AdminManagersController, AdminTenantManagerController } from './admin-managers.controller';
import { AdminManagersService } from './admin-managers.service';
import { ManagerCabinetController } from './manager-cabinet.controller';
import { ManagerCabinetService } from './manager-cabinet.service';
import { ManagerFinanceService } from './manager-finance.service';

/**
 * Менеджеры платформы (173): сотрудники владельца Autexa без тенанта, которые заводят
 * автосервисы, продлевают им подписки и получают учёт своей доли.
 *
 * Модуль не владеет данными тенантов — он ходит в них ЧЕРЕЗ TenantsService (единственное
 * место с бизнес-логикой подписок: продления, смена тарифа, вход под владельцем) и
 * передаёт туда область видимости менеджера. PG_POOL приходит из глобального DatabaseModule,
 * JwtService (для токена входа под владельцем) — из AuthModule через TenantsService.
 */
@Module({
  imports: [TenantsModule, AuthModule, SettingsModule],
  controllers: [AdminManagersController, AdminTenantManagerController, ManagerCabinetController],
  providers: [ManagerFinanceService, AdminManagersService, ManagerCabinetService],
})
export class PlatformManagersModule {}
