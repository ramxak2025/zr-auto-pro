import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, IsInt, Min } from 'class-validator';
import { WarehousesService } from './warehouses.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// DTO is defined inline because the warehouses module has a tiny surface
// (rename only) — splitting it into a dedicated dto/ folder would add files
// without value.
class UpdateWarehouseDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('warehouses')
export class WarehousesController {
  constructor(private warehousesService: WarehousesService) {}

  // Anyone authenticated in the tenant needs to see the warehouse list —
  // the FE uses it to render filter tabs / dropdowns. Mutations are
  // restricted to director / admin / superadmin below.
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.warehousesService.listByTenant(user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateWarehouseDto) {
    return this.warehousesService.update(user.tenantID, id, dto);
  }
}
