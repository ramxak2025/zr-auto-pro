import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ServicesService } from './services.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// ROLE-ONLY (консолидация 2026-07). Enforcement на сервере, не в UI:
//   • view   — смотреть услуги + добавлять в чек → @RequirePermission('services_view');
//   • manage — создавать/редактировать/менять %+гарантию/удалять → 'services_manage'.
// Owner-class (director/admin/superadmin) обходит гейты через PermissionsGuard.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('services')
export class ServicesController {
  constructor(private servicesService: ServicesService) {}

  @RequirePermission('services_view')
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.servicesService.getAll(user.tenantID, query);
  }

  @RequirePermission('services_view')
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.servicesService.getById(id, user.tenantID);
  }

  @RequirePermission('services_manage')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.servicesService.create(user.tenantID, dto);
  }

  @RequirePermission('services_manage')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.servicesService.update(id, user.tenantID, dto);
  }

  @RequirePermission('services_manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.servicesService.remove(id, user.tenantID);
  }
}
