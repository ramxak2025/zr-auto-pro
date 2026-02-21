import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { PlansService } from './plans.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('plans')
export class PlansController {
  constructor(private plansService: PlansService) {}

  @Get()
  getAll() {
    return this.plansService.getAll();
  }

  @Post()
  create(@Body() dto: any) {
    return this.plansService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: any) {
    return this.plansService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }
}
