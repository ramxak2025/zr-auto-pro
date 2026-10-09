import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PutServiceVisibilityRuleDto } from './dto/put-service-visibility-rule.dto';

// ROLE-ONLY (консолидация 2026-07). Enforcement на сервере, не в UI:
//   • view   — смотреть услуги + добавлять в чек → @RequirePermission('services_view');
//   • manage — создавать/редактировать/менять %+гарантию/удалять → 'services_manage'.
// Owner-class (director/admin/superadmin) обходит гейты через PermissionsGuard.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('services')
export class ServicesController {
  constructor(private servicesService: ServicesService) {}

  @RequirePermission('services_manage')
  @Get('visibility/config')
  getVisibilityConfig(@CurrentUser() user: JwtPayload) {
    return this.servicesService.getVisibilityConfig(user.tenantID);
  }

  @RequirePermission('services_manage')
  @Put('visibility/rule')
  putVisibilityRule(@CurrentUser() user: JwtPayload, @Body() dto: PutServiceVisibilityRuleDto) {
    return this.servicesService.putVisibilityRule(user.tenantID, dto);
  }

  @RequirePermission('services_manage')
  @Delete('visibility/service/:id')
  deleteServiceVisibilityRule(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.servicesService.deleteVisibilityRule(user.tenantID, { serviceId: id });
  }

  @RequirePermission('services_manage')
  @Delete('visibility/category')
  deleteCategoryVisibilityRule(@Query('path') path: string, @CurrentUser() user: JwtPayload) {
    return this.servicesService.deleteVisibilityRule(user.tenantID, { categoryPath: path });
  }

  @RequirePermission('services_manage')
  @Get('export')
  exportCatalog(@CurrentUser() user: JwtPayload) {
    return this.servicesService.exportCatalog(user.tenantID);
  }

  @RequirePermission('services_manage')
  @Post('import/preview')
  previewImport(@CurrentUser() user: JwtPayload, @Body() body: { rows?: unknown }) {
    return this.servicesService.previewImport(user.tenantID, user.userID, body?.rows);
  }

  @RequirePermission('services_manage')
  @Post('import/confirm')
  confirmImport(@CurrentUser() user: JwtPayload, @Body() body: { previewId: string; requestId: string }) {
    return this.servicesService.confirmImport(user.tenantID, user.userID, body?.previewId, body?.requestId);
  }

  @RequirePermission('services_view')
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.servicesService.getAll(user.tenantID, query, user);
  }

  @RequirePermission('services_view')
  @Get(':id/price-history')
  getPriceHistory(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload) {
    return this.servicesService.getPriceHistory(id, user.tenantID);
  }

  @RequirePermission('services_view')
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.servicesService.getById(id, user.tenantID);
  }

  @RequirePermission('services_manage')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.servicesService.create(user.tenantID, dto, user.userID);
  }

  @RequirePermission('services_manage')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.servicesService.update(id, user.tenantID, dto, user.userID);
  }

  @RequirePermission('services_manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.servicesService.remove(id, user.tenantID);
  }
}
