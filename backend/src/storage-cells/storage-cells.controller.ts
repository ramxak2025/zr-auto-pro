import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { StorageCellsService } from './storage-cells.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId } from '../common/point-scope';
import { ParseUuidParam } from '../common/parse-uuid.pipe';
import { CreateStorageCellDto } from './dto/create-storage-cell.dto';
import { BulkCreateStorageCellsDto } from './dto/bulk-create-storage-cells.dto';
import { UpdateStorageCellDto } from './dto/update-storage-cell.dto';
import { UpdateStorageCellsOrderDto } from './dto/update-storage-cells-order.dto';

// Ячейки хранения (172). Гейты как у склада: чтение — 'warehouse_access' (мастеру
// нужно видеть адрес в подборе), изменение — 'warehouse_manage'. Owner-class
// (director/admin/superadmin) обходит через PermissionsGuard. Филиал сессии режет
// доступ через склад ячейки (см. StorageCellsService).
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('storage-cells')
export class StorageCellsController {
  constructor(private storageCellsService: StorageCellsService) {}

  @RequirePermission('warehouse_access')
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query('warehouseId') warehouseId?: string) {
    return this.storageCellsService.list(user.tenantID, warehouseId, actorPointId(user));
  }

  @RequirePermission('warehouse_manage')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateStorageCellDto) {
    return this.storageCellsService.create(user.tenantID, dto, actorPointId(user));
  }

  // Литеральные маршруты (`bulk`, `order`) ОБЯЗАНЫ стоять раньше `:id` — иначе
  // `PATCH /storage-cells/order` уйдёт в update() с id = 'order'.
  @RequirePermission('warehouse_manage')
  @Post('bulk')
  bulkCreate(@CurrentUser() user: JwtPayload, @Body() dto: BulkCreateStorageCellsDto) {
    return this.storageCellsService.bulkCreate(user.tenantID, dto, actorPointId(user));
  }

  @RequirePermission('warehouse_manage')
  @Patch('order')
  updateOrder(@CurrentUser() user: JwtPayload, @Body() dto: UpdateStorageCellsOrderDto) {
    return this.storageCellsService.updateOrder(user.tenantID, dto.orderedIds, actorPointId(user));
  }

  @RequirePermission('warehouse_manage')
  @Patch(':id')
  update(@Param('id', ParseUuidParam) id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateStorageCellDto) {
    return this.storageCellsService.update(user.tenantID, id, dto, actorPointId(user));
  }

  // Ячейка с товарами удаляется только с `moveTo` (ячейка того же склада) или
  // `detach=true`; иначе 409 STORAGE_CELL_NOT_EMPTY { productsCount }.
  @RequirePermission('warehouse_manage')
  @Delete(':id')
  remove(
    @Param('id', ParseUuidParam) id: string,
    @CurrentUser() user: JwtPayload,
    @Query('moveTo') moveTo?: string,
    @Query('detach') detach?: string,
  ) {
    return this.storageCellsService.remove(
      user.tenantID,
      id,
      { moveTo, detach: detach === 'true' || detach === '1' },
      actorPointId(user),
    );
  }
}
