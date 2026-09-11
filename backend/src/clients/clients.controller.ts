import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Res, Header } from '@nestjs/common';
import { Response } from 'express';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId } from '../common/point-scope';

// SPLIT client permissions (build-50 → матрица, миграция 136). Enforcement:
//   • Reading (GET /, lookup-by-phone, :id, :id/checks-by-car) → 'clients_view'
//     (сид true у всех трёх системных ролей, включая мастера — прогрессивный
//     поиск по телефону в Кассе сохраняется 1:1).
//   • Editing an EXISTING client's profile (name/phone/comment/source/notes) →
//     'clients_edit' (defaults FALSE for masters). Gates the three PATCH /:id* routes.
//   • CREATE a walk-in client (POST /clients) stays OPEN — masters need it in
//     Касса and hold 'clients_view' but not 'clients_edit'.
//   • DELETE → 'clients_delete' (clients.delete, миграция 136).
// Owner-class (director/superadmin) bypasses the key gates via PermissionsGuard.
//
// 163 — вниз, в сервис, течёт ФИЛИАЛ СЕССИИ (actorPointId), а не userID: при
// раздельной базе клиентов (tenants.points_shared_clients=false) именно он
// решает, чью базу человек видит. Раньше сервис перечитывал филиал из
// users.current_point_id — одной колонки на все устройства человека, — и веб
// показывал базу того филиала, который выбрали в телефоне.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('clients')
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @RequirePermission('clients_view')
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.clientsService.getAll(user.tenantID, query, actorPointId(user));
  }

  // Выгрузка всей клиентской базы (имя+телефон) — ровно то, от чего защищает
  // дефолт export_data=false у мастера (увод базы при увольнении). Гейт тем же
  // ключом; owner-class обходит через PermissionsGuard.
  @RequirePermission('export_data')
  @Get('export-csv')
  async exportCsv(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    // Выгрузка = ровно та база, которую видит человек (161).
    const csv = await this.clientsService.exportCsv(user.tenantID, actorPointId(user));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="clients.csv"');
    // Add BOM for Excel
    res.send('\uFEFF' + csv);
  }

  /**
   * Look up an existing client by phone in the current tenant. Used by the
   * UI to warn the user before creating a duplicate. Returns null when no
   * match found, or the client record otherwise.
   */
  @RequirePermission('clients_view')
  @Get('lookup-by-phone')
  lookupByPhone(@CurrentUser() user: JwtPayload, @Query('phone') phone: string) {
    return this.clientsService.findByPhone(user.tenantID, phone || '', actorPointId(user));
  }

  @RequirePermission('clients_view')
  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clientsService.getById(id, user.tenantID, actorPointId(user));
  }

  /**
   * Checks for one client grouped by car. Returned shape is
   * `PerCarChecks[]` so the FE can render a tab-per-car layout without an
   * extra merge step on its side.
   */
  @RequirePermission('clients_view')
  @Get(':id/checks-by-car')
  getChecksByCar(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.clientsService.getChecksByCar(
      id,
      user.tenantID,
      {
        limit: limit !== undefined ? parseInt(limit, 10) : undefined,
        offset: offset !== undefined ? parseInt(offset, 10) : undefined,
      },
      actorPointId(user),
    );
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.clientsService.create(user.tenantID, dto, actorPointId(user));
  }

  // Edit an EXISTING client's own profile fields (name/phone/comment/source/
  // owner_notes). Distinct from POST /clients (walk-in create) which stays open
  // so masters can add a client in Касса without 'clients_edit'.
  @RequirePermission('clients_edit')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.clientsService.update(id, user.tenantID, dto, actorPointId(user));
  }

  /**
   * Targeted update for the source tag only. The owner often adjusts source
   * without touching the rest of the client; a focused endpoint avoids the
   * full diff payload and lets the FE invalidate just the source field.
   */
  @RequirePermission('clients_edit')
  @Patch(':id/source')
  updateSource(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { source: string | null }) {
    return this.clientsService.updateSource(id, user.tenantID, dto?.source ?? null, actorPointId(user));
  }

  /**
   * Owner notes — free-form text used for "VIP клиент", "Не звонить", etc.
   * Capped at 4000 chars server-side.
   */
  @RequirePermission('clients_edit')
  @Patch(':id/notes')
  updateNotes(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { notes: string | null }) {
    return this.clientsService.updateNotes(id, user.tenantID, dto?.notes ?? null, actorPointId(user));
  }

  // Удаление клиента — 'clients_delete' (clients.delete, миграция 136);
  // owner-class (director/superadmin) обходит через PermissionsGuard.
  @RequirePermission('clients_delete')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clientsService.remove(id, user.tenantID, actorPointId(user));
  }
}
