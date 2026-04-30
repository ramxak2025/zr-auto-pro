import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards, Query } from '@nestjs/common';
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
  removeCategory(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('moveTo') moveTo?: string,
    @Query('deleteContents') deleteContents?: string,
  ) {
    return this.warehouseService.removeCategory(
      id,
      user.tenantID,
      moveTo,
      deleteContents === 'true' || deleteContents === '1',
    );
  }

  @Patch('categories/order')
  updateOrder(@CurrentUser() user: JwtPayload, @Body('orderedIds') orderedIds: string[]) {
    return this.warehouseService.updateOrder(user.tenantID, orderedIds);
  }

  @Patch('categories/:id/rename')
  renameCategory(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body('newPath') newPath: string,
  ) {
    return this.warehouseService.renameCategory(id, user.tenantID, newPath);
  }
}
