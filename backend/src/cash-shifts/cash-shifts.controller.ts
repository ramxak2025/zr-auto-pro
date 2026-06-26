import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CashShiftsService } from './cash-shifts.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';
import { CollectCashDto } from './dto/collect-cash.dto';

/**
 * Кассовая смена / Z-отчёт / Инкассация — tenant-scoped from the JWT.
 *
 * Read endpoints (current / report / list) are open to ANY authenticated user
 * in the tenant (no @Roles ⇒ RolesGuard passes everyone) so a cashier who runs
 * the Касса can see the live figures — consistent with /checks and /expenses
 * GET being role-open. The MUTATIONS that move the drawer (open / close /
 * collect) are restricted to owner-class roles.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
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

  // ─── Mutations (owner-class only) ──────────────────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Post('open')
  open(@CurrentUser() user: JwtPayload, @Body() dto: OpenShiftDto) {
    return this.cashShifts.open(user, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/close')
  close(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CloseShiftDto) {
    return this.cashShifts.close(user, id, dto);
  }

  @Roles('director', 'admin', 'superadmin')
  @Post(':id/collect')
  collect(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: CollectCashDto) {
    return this.cashShifts.collect(user, id, dto);
  }
}
