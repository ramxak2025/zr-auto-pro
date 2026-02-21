import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller()
export class TenantsController {
  constructor(private tenantsService: TenantsService) {}

  @Get('tenants')
  getAll() {
    return this.tenantsService.getAll();
  }

  @Get('tenants/stats')
  getStats() {
    return this.tenantsService.getStats();
  }

  @Get('tenants/:id')
  getById(@Param('id') id: string) {
    return this.tenantsService.getById(id);
  }

  @Post('tenants')
  create(@Body() dto: any) {
    return this.tenantsService.create(dto);
  }

  @Patch('tenants/:id')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.tenantsService.update(id, dto);
  }

  @Delete('tenants/:id')
  remove(@Param('id') id: string) {
    return this.tenantsService.remove(id);
  }

  @Get('subscription')
  getSubscription(@CurrentUser() user: JwtPayload) {
    return this.tenantsService.getSubscription(user.tenantID);
  }
}
