import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Res, Header } from '@nestjs/common';
import { Response } from 'express';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// SPLIT client permissions (build-50). Enforcement on the server:
//   • Editing an EXISTING client's profile (name/phone/comment/source/notes) →
//     'clients_edit' (defaults FALSE for masters). Gates the three PATCH /:id* routes.
//   • CREATE a walk-in client (POST /clients), reading (GET *), selecting a client
//     for a check, and attaching a car (cars controller) stay OPEN — masters need
//     them in Касса and hold 'clients_view' (defaults true) but not 'clients_edit'.
//   • DELETE stays owner-class via @Roles below.
// Owner-class (director/admin/superadmin) bypasses the key gate via PermissionsGuard.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('clients')
export class ClientsController {
  constructor(private clientsService: ClientsService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.clientsService.getAll(user.tenantID, query);
  }

  @Get('export-csv')
  async exportCsv(@CurrentUser() user: JwtPayload, @Res() res: Response) {
    const csv = await this.clientsService.exportCsv(user.tenantID);
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
  @Get('lookup-by-phone')
  lookupByPhone(@CurrentUser() user: JwtPayload, @Query('phone') phone: string) {
    return this.clientsService.findByPhone(user.tenantID, phone || '');
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clientsService.getById(id, user.tenantID);
  }

  /**
   * Checks for one client grouped by car. Returned shape is
   * `PerCarChecks[]` so the FE can render a tab-per-car layout without an
   * extra merge step on its side.
   */
  @Get(':id/checks-by-car')
  getChecksByCar(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.clientsService.getChecksByCar(id, user.tenantID, {
      limit: limit !== undefined ? parseInt(limit, 10) : undefined,
      offset: offset !== undefined ? parseInt(offset, 10) : undefined,
    });
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.clientsService.create(user.tenantID, dto);
  }

  // Edit an EXISTING client's own profile fields (name/phone/comment/source/
  // owner_notes). Distinct from POST /clients (walk-in create) which stays open
  // so masters can add a client in Касса without 'clients_edit'.
  @RequirePermission('clients_edit')
  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.clientsService.update(id, user.tenantID, dto);
  }

  /**
   * Targeted update for the source tag only. The owner often adjusts source
   * without touching the rest of the client; a focused endpoint avoids the
   * full diff payload and lets the FE invalidate just the source field.
   */
  @RequirePermission('clients_edit')
  @Patch(':id/source')
  updateSource(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { source: string | null }) {
    return this.clientsService.updateSource(id, user.tenantID, dto?.source ?? null);
  }

  /**
   * Owner notes — free-form text used for "VIP клиент", "Не звонить", etc.
   * Capped at 4000 chars server-side.
   */
  @RequirePermission('clients_edit')
  @Patch(':id/notes')
  updateNotes(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { notes: string | null }) {
    return this.clientsService.updateNotes(id, user.tenantID, dto?.notes ?? null);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.clientsService.remove(id, user.tenantID);
  }
}
