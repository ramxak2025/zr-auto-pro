import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { WarehouseService } from './warehouse.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('warehouse')
export class WarehouseController {
  constructor(private warehouseService: WarehouseService) {}

  @Get('categories')
  getCategories(@CurrentUser() user: JwtPayload) {
    return this.warehouseService.getCategories(user.tenantID);
  }

  @Post('categories')
  createCategory(@CurrentUser() user: JwtPayload, @Body('path') path: string) {
    return this.warehouseService.createCategory(user.tenantID, path);
  }

  @Delete('categories/:id')
  removeCategory(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.warehouseService.removeCategory(id, user.tenantID);
  }
}
