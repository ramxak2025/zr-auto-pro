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

  /**
   * Look up an existing car by plate in the current tenant. Used by the UI
   * to warn before creating a duplicate. Plate is normalized server-side.
   */
  @Get('lookup-by-plate')
  lookupByPlate(@CurrentUser() user: JwtPayload, @Query('plate') plate: string) {
    return this.carsService.findByPlate(user.tenantID, plate || '');
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.carsService.getById(id, user.tenantID);
  }

  /**
   * Per-car check history — used by the car detail panel and the cash
   * screen "история по машине" section. `limit` capped at 200 server-side.
   */
  @Get(':id/checks')
  getChecks(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    const numericLimit = parseInt(String(limit ?? '50'), 10);
    return this.carsService.getChecks(id, user.tenantID, Math.min(Math.max(numericLimit || 50, 1), 200));
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
