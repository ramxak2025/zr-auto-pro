import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { CarsService } from './cars.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('cars')
export class CarsController {
  constructor(private carsService: CarsService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.carsService.getAll(user.tenantID, query);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.carsService.getById(id, user.tenantID);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.carsService.create(user.tenantID, dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.carsService.update(id, user.tenantID, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.carsService.remove(id, user.tenantID);
  }
}
