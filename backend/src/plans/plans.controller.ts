import { Controller, Get, Post, Put, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { PlansService } from './plans.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { SetPlanFeaturesDto } from './dto/set-features.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('plans')
export class PlansController {
  constructor(private plansService: PlansService) {}

  @Get()
  getAll() {
    return this.plansService.getAll();
  }

  /**
   * Full toggleable feature catalog for the superadmin plan editor. Static
   * `features-catalog` segment is declared before any `:id` route so it never
   * collides with a param match.
   */
  @Roles('superadmin')
  @Get('features-catalog')
  getFeatureCatalog() {
    return this.plansService.getFeatureCatalog();
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

  /** Replace the plan's ENABLED feature set (validated against the catalog). */
  @Roles('superadmin')
  @Put(':id/features')
  setFeatures(@Param('id') id: string, @Body() dto: SetPlanFeaturesDto) {
    return this.plansService.setFeatures(id, dto.features);
  }

  @Roles('superadmin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.plansService.remove(id);
  }
}
