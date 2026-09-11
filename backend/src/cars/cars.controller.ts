import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { CarsService } from './cars.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { TransferOwnerDto } from './dto/transfer-owner.dto';
import { actorPointId } from '../common/point-scope';

// Gating mirrors the clients module (гараж клиента = clients-домен):
//   • reads (GET /, lookup-by-plate, :id, :id/checks) → 'clients_view' (сид
//     true у всех трёх системных ролей — lookup-by-plate в Кассе у мастера
//     сохраняется 1:1);
//   • CREATE stays open — a master must still be able to add a car from the
//     Касса screen (guards are a no-op for undecorated routes);
//   • PATCH /:id → 'clients_edit', same tier as PATCH /clients/:id and
//     transfer-owner. An open PATCH let any master reassign the car's owner
//     via `clientId` (обход гейта transfer-owner, история чеков рвалась);
//   • DELETE /:id → 'clients_delete' (clients.delete, миграция 136), same as
//     DELETE /clients/:id — hard delete без корзины, checks.car_id уходит в
//     NULL (006_fix_fk_cascade).
// Owner-class (director/superadmin) bypasses permission gates.
//
// 163 — последним аргументом вниз идёт ФИЛИАЛ СЕССИИ (actorPointId), а не
// userID: гараж режется тем же предикатом, что база клиентов
// (ClientsService.separatePointFor), и филиал обязан быть филиалом ЭТОЙ сессии.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('cars')
export class CarsController {
  constructor(private carsService: CarsService) {}

  @RequirePermission('clients_view')
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.carsService.getAll(user.tenantID, query, actorPointId(user));
  }

  /**
   * Look up an existing car by plate in the current tenant. Used by the UI
   * to warn before creating a duplicate. Plate is normalized server-side.
   */
  @RequirePermission('clients_view')
  @Get('lookup-by-plate')
  lookupByPlate(@CurrentUser() user: JwtPayload, @Query('plate') plate: string) {
    return this.carsService.findByPlate(user.tenantID, plate || '', actorPointId(user));
  }

  @RequirePermission('clients_view')
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.carsService.getById(id, user.tenantID, actorPointId(user));
  }

  /**
   * Per-car check history — used by the car detail panel and the cash
   * screen "история по машине" section. `limit` capped at 200 server-side.
   */
  @RequirePermission('clients_view')
  @Get(':id/checks')
  getChecks(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Query('limit') limit?: string) {
    const numericLimit = parseInt(String(limit ?? '50'), 10);
    return this.carsService.getChecks(
      id,
      user.tenantID,
      Math.min(Math.max(numericLimit || 50, 1), 200),
      actorPointId(user),
    );
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.carsService.create(user.tenantID, dto, actorPointId(user));
  }

  @RequirePermission('clients_edit')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.carsService.update(id, user.tenantID, dto, actorPointId(user));
  }

  @RequirePermission('clients_delete')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.carsService.remove(id, user.tenantID, actorPointId(user));
  }

  /**
   * Reassign a car to a new owner («сменить владельца»). moveHistory (default
   * true) also carries the car's check history — and the debt / installment /
   * loyalty rows derived from those checks — to the new client. Gated by
   * 'clients_edit'; owner-class bypasses via PermissionsGuard.
   */
  @RequirePermission('clients_edit')
  @Post(':id/transfer-owner')
  transferOwner(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: TransferOwnerDto) {
    return this.carsService.transferOwner(
      id,
      user.tenantID,
      dto.clientId,
      dto.moveHistory !== false,
      actorPointId(user),
    );
  }
}
