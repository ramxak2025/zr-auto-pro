import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  // ─── Superadmin-only routes (manage all tenants) ──────────────────

  @Roles('superadmin')
  @Get('tenants')
  getAll() {
    return this.tenantsService.getAll();
  }

  @Roles('superadmin')
  @Get('tenants/stats')
  getStats() {
    return this.tenantsService.getStats();
  }

  @Roles('superadmin')
  @Get('tenants/:id')
  getById(@Param('id') id: string) {
    return this.tenantsService.getById(id);
  }

  @Roles('superadmin')
  @Post('tenants')
  create(@Body() dto: any) {
    return this.tenantsService.create(dto);
  }

  @Roles('superadmin')
  @Patch('tenants/:id')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.tenantsService.update(id, dto);
  }

  @Roles('superadmin')
  @Delete('tenants/:id')
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }

  // ─── Director routes (own company settings) ─────────────────────

  @Roles('director', 'superadmin')
  @Get('my-company')
  getMyCompany(@CurrentUser() user: JwtPayload) {
    return this.tenantsService.getMyCompany(user.tenantID);
  }

  @Roles('director', 'superadmin')
  @Patch('my-company')
  updateMyCompany(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.tenantsService.updateMyCompany(user.tenantID, dto);
  }

  // ─── Regular user route (view own subscription) ───────────────────

  @Get('subscription')
  getSubscription(@CurrentUser() user: JwtPayload) {
    return this.tenantsService.getSubscription(user.tenantID);
  }
}
