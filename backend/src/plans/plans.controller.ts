import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { PlansService } from './plans.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('plans')
export class PlansController {
  constructor(private plansService: PlansService) {}

  @Get()
  getAll() {
    return this.plansService.getAll();
  }

  @Roles('superadmin')
  @Post()
  create(@Body() dto: any) {
    return this.plansService.create(dto);
  }

  @Roles('superadmin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.plansService.update(id, dto);
  }

  @Roles('superadmin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }
}
