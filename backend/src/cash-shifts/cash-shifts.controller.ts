import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CashShiftsService } from './cash-shifts.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CollectCashDto } from './dto/collect-cash.dto';

/**
 * Кассовая смена / Z-отчёт / Инкассация — tenant-scoped from the JWT.
 *
 * Read endpoints (current / report / list) are open to ANY authenticated user
 * in the tenant (undecorated ⇒ guards pass everyone) so a cashier who runs
 * the Касса can see the live figures — consistent with /checks and /expenses
 * GET being role-open. The MUTATIONS that move the drawer (open / close /
 * collect) are gated by the 'cash_shifts_manage' matrix cell (checks.cashShifts,
 * миграция 136) — the matrix is authoritative; owner-class (director/superadmin)
 * bypasses via PermissionsGuard.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('cash-shifts')
export class CashShiftsController {
  constructor(private cashShifts: CashShiftsService) {}

  // ─── Reads (literal routes first so 'current' isn't captured as :id) ───
  @Get('current')
  current(@CurrentUser() user: JwtPayload) {
    return this.cashShifts.current(user.tenantID);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: { page?: string; limit?: string }) {
    return this.cashShifts.list(user.tenantID, query);
  }

  @Get(':id/report')
  report(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.cashShifts.report(user.tenantID, id);
  }

  // ─── Mutations ('cash_shifts_manage') ──────────────────────────────────
  @RequirePermission('cash_shifts_manage')
  @Post('open')
  open(@CurrentUser() user: JwtPayload, @Body() dto: OpenShiftDto) {
    return this.cashShifts.open(user, dto);
  }

  @RequirePermission('cash_shifts_manage')
  @Post(':id/close')
  close(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CloseShiftDto) {
    return this.cashShifts.close(user, id, dto);
  }

  @RequirePermission('cash_shifts_manage')
  @Post(':id/collect')
  collect(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CollectCashDto) {
    return this.cashShifts.collect(user, id, dto);
  }
}
