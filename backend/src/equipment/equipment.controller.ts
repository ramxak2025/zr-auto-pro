import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { EquipmentService } from './equipment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('equipment')
export class EquipmentController {
  constructor(private service: EquipmentService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.service.getAll(user.tenantID, query);
  }

  @Get('summary')
  getSummary(@CurrentUser() user: JwtPayload) {
    return this.service.getSummaryByUser(user.tenantID);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.getById(id, user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.create(user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.update(id, user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/replace')
  replace(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.replace(id, user.tenantID, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/write-off')
  writeOff(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.writeOff(id, user.tenantID, dto?.reason);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/return')
  returnItem(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.service.returnItem(id, user.tenantID, dto?.reason);
  }

  @Roles('director', 'superadmin')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.service.remove(id, user.tenantID);
  }
}
