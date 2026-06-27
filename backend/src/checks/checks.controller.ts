import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ChecksService } from './checks.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('checks')
export class ChecksController {
  constructor(private checksService: ChecksService) {}

  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    // Pass the actor so the service can apply the checks_view_all rule: a master
    // without that permission sees only their own checks (master_id = self).
    // Owner-class roles see every check in the tenant. Response shape unchanged.
    return this.checksService.getAll(user.tenantID, query, user);
  }

  @Get('dashboard')
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.checksService.getDashboard(user.tenantID);
  }

  @Get('dashboard/chart')
  getDashboardChart(@CurrentUser() user: JwtPayload, @Query('period') period: string, @Query('offset') offset: string) {
    return this.checksService.getDashboardChart(user.tenantID, period, parseInt(offset) || 0);
  }

  @Get('ranking')
  getRanking(@CurrentUser() user: JwtPayload) {
    return this.checksService.getRanking(user.tenantID);
  }

  /**
   * Last visit (most recent check) for a given client and / or car. Used by
   * the cash screen to surface "Последний визит: ..." once a client/car is
   * selected, so the master immediately sees when the customer was here last.
   */
  @Get('last-visit')
  getLastVisit(@CurrentUser() user: JwtPayload, @Query('clientId') clientId?: string, @Query('carId') carId?: string) {
    return this.checksService.getLastVisit(user.tenantID, { clientId, carId });
  }

  /**
   * Kanban board (082): заказ-наряды grouped by work_status, tenant-scoped.
   * Declared BEFORE `:id` so the literal path isn't swallowed by the param route.
   * Returns { accepted, in_progress, ready, delivered }, each newest-first.
   */
  @Roles('director', 'admin', 'master', 'superadmin')
  @Get('board')
  getBoard(@CurrentUser() user: JwtPayload) {
    return this.checksService.getBoard(user.tenantID, user);
  }

  // ── Board columns (091): owner-configurable kanban columns ──────────────
  // All declared BEFORE `:id` routes so the literal `board-columns` path (and
  // `board-columns/:id`) is never swallowed by the param routes.

  /**
   * List the tenant's board columns (active + inactive), ordered by sort_order.
   * Read is open to the same board-viewing roles as GET /checks/board.
   */
  @Roles('director', 'admin', 'master', 'superadmin')
  @Get('board-columns')
  listBoardColumns(@CurrentUser() user: JwtPayload) {
    return this.checksService.listBoardColumns(user.tenantID);
  }

  /**
   * Create a board column. Owner-class only — masters move checks along the
   * board but cannot reshape it. `key` is auto-derived server-side.
   */
  @Roles('director', 'admin', 'superadmin')
  @Post('board-columns')
  createBoardColumn(
    @CurrentUser() user: JwtPayload,
    @Body() dto: { label?: string; color?: string; notifyClient?: boolean },
  ) {
    return this.checksService.createBoardColumn(user.tenantID, dto);
  }

  /** Edit / reorder / hide a board column. Owner-class only. */
  @Roles('director', 'admin', 'superadmin')
  @Patch('board-columns/:id')
  updateBoardColumn(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: { label?: string; color?: string; sortOrder?: number; isActive?: boolean; notifyClient?: boolean },
  ) {
    return this.checksService.updateBoardColumn(user.tenantID, id, dto);
  }

  /**
   * Delete a board column. Owner-class only. Any checks parked in it are taken
   * off the board (work_status → NULL), tenant-scoped & transactional.
   */
  @Roles('director', 'admin', 'superadmin')
  @Delete('board-columns/:id')
  removeBoardColumn(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checksService.deleteBoardColumn(user.tenantID, id);
  }

  // ── POS shift-mode settings (092) ───────────────────────────────────────
  // Declared BEFORE `:id` so the literal `pos-settings` path isn't swallowed by
  // the param route.

  /**
   * Read the tenant's POS «Кассовая смена + роли» mode + whether the CALLER is a
   * cashier. Open to any authenticated role: a master needs the flag to swap its
   * tab bar / order-create flow. `isCashier` is derived server-side (owner-class
   * role OR the `accept_payment` permission).
   */
  @Get('pos-settings')
  getPosSettings(@CurrentUser() user: JwtPayload) {
    return this.checksService.getPosSettings(user.tenantID, user);
  }

  /**
   * Flip POS shift-mode on/off. Owner-class only (the same set that configures
   * the rest of company settings). Body carries only `shiftModeEnabled`.
   */
  @Roles('director', 'admin', 'superadmin')
  @Patch('pos-settings')
  updatePosSettings(@CurrentUser() user: JwtPayload, @Body() dto: { shiftModeEnabled?: boolean }) {
    return this.checksService.updatePosSettings(user.tenantID, dto);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checksService.getById(id, user.tenantID);
  }

  /**
   * Set the kanban work-status (082). Additive, orthogonal to payment — masters
   * move their own work along the board, owner-class roles move anything. Path
   * has two segments so it never collides with `@Patch(':id')`.
   */
  @Roles('director', 'admin', 'master', 'superadmin')
  @Patch(':id/work-status')
  setWorkStatus(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: { workStatus?: string }) {
    return this.checksService.setWorkStatus(id, user.tenantID, dto?.workStatus);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    // `user` is forwarded as the actor so the service can resolve the cashier
    // role-gate (role + permissions) when POS shift-mode is ON. OFF → ignored.
    return this.checksService.create(user.tenantID, user.userID, user.role, dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.checksService.update(id, user.tenantID, user.role, dto, user.userID, user);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.checksService.remove(id, user.tenantID, user.role);
  }
}
