import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateSalaryPaymentDto } from './dto/create-payment.dto';
import { CreatePremiumDto } from './dto/create-premium.dto';
import { CreatePenaltyDto } from './dto/create-penalty.dto';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { DecidePayoutDto } from './dto/decide-payout.dto';

// «Владелец» (issues payouts / fines) = director + superadmin. admin + master
// are employees: they never issue, and see only their own salary. superadmin is
// always allowed via the RolesGuard bypass; listed explicitly for clarity.
const OWNER_ROLES = ['director', 'superadmin'];

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('salary')
export class SalaryController {
  constructor(private salaryService: SalaryService) {}

  // Listing every master's earnings + paid-out amounts reveals what every
  // colleague is getting paid — that is owner / director / admin level data.
  @Roles('director', 'admin', 'superadmin')
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.salaryService.getAll(user.tenantID, query);
  }

  // `getMy` filters by the JWT subject inside the service — every authenticated
  // user is allowed to see their OWN earnings. No role gate.
  @Get('my')
  getMy(@CurrentUser() user: JwtPayload) {
    return this.salaryService.getMy(user.tenantID, user.userID);
  }

  // Same reasoning as getAll — payment history of every employee is internal
  // finance data.
  @Roles('director', 'admin', 'superadmin')
  @Get('payments')
  getPayments(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.salaryService.getPayments(user.tenantID, query);
  }

  @Roles('director', 'superadmin')
  @Post('payments')
  createPayment(@CurrentUser() user: JwtPayload, @Body() dto: CreateSalaryPaymentDto) {
    return this.salaryService.createPayment(user.tenantID, user.userID, dto);
  }

  // Employee confirms receipt of a payment. The service rejects calls from
  // anyone other than the payment owner, so the role gate is intentionally
  // open here.
  @Post('payments/:id/confirm')
  confirmPayment(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.salaryService.confirmPayment(id, user.tenantID, user.userID);
  }

  // ── Payouts with confirmation (100_salary_payouts_and_fines) ─────────────

  // Owner issues a ЗП / АВАНС; employee then accepts or rejects it.
  @Roles(...OWNER_ROLES)
  @Post('payouts')
  createPayout(@CurrentUser() user: JwtPayload, @Body() dto: CreatePayoutDto) {
    return this.salaryService.createPayout(user.tenantID, user.userID, dto);
  }

  // Employee's decision on a pending payout. Role gate is intentionally open —
  // the service authorizes the caller as the recipient (and ignores anyone
  // else), mirroring confirmPayment above.
  @Post('payouts/:id/decide')
  decidePayout(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: DecidePayoutDto) {
    return this.salaryService.decidePayout(id, user.tenantID, user.userID, dto.decision);
  }

  // List payouts + statuses. Owner (director/superadmin) sees the whole tenant;
  // an employee (admin/master) is scoped to their OWN payouts — we force the
  // employeeId filter to themselves so they can't read a colleague's or dump
  // the tenant. Same self-scoping pattern as listPremiums.
  @Get('payouts')
  listPayouts(
    @CurrentUser() user: JwtPayload,
    @Query() query: { employeeId?: string; status?: 'pending' | 'accepted' | 'rejected'; monthYear?: string },
  ) {
    const privileged = OWNER_ROLES.includes(user.role);
    const q = { ...(query || {}) };
    if (!privileged) q.employeeId = user.userID;
    return this.salaryService.listPayouts(user.tenantID, q);
  }

  // Per-employee monthly salary detail (the full-screen card pages months).
  // Owner can view any employee in the tenant; an employee is forced to self.
  @Get('employee/:employeeId/month')
  getEmployeeMonth(
    @Param('employeeId') employeeId: string,
    @CurrentUser() user: JwtPayload,
    @Query('month') month?: string,
  ) {
    const privileged = OWNER_ROLES.includes(user.role);
    const target = privileged ? employeeId : user.userID;
    return this.salaryService.getEmployeeMonth(user.tenantID, target, month);
  }

  // ── Premiums ───────────────────────────────────────────────────────────

  @Roles('director', 'admin', 'superadmin')
  @Post('premiums')
  createPremium(@CurrentUser() user: JwtPayload, @Body() dto: CreatePremiumDto) {
    return this.salaryService.createPremium(user.tenantID, user.userID, dto);
  }

  /**
   * Returns the tenant's premiums. With no filters this is the owner's
   * audit view; passing `?userId=` returns a single master's premiums
   * (master themselves can use this to see their own awarded premiums).
   */
  @Get('premiums')
  listPremiums(@CurrentUser() user: JwtPayload, @Query() query: { userId?: string; monthYear?: string }) {
    // A non-privileged user may only see their OWN premiums — force the userId
    // filter to themselves so a master can't pass ?userId=<colleague> (read a
    // colleague's bonuses) or omit it to dump the whole tenant's premium
    // history. Director / admin / superadmin keep the full audit view.
    const privileged = ['director', 'admin', 'superadmin'].includes(user.role);
    const q = { ...(query || {}) };
    if (!privileged) q.userId = user.userID;
    return this.salaryService.listPremiums(user.tenantID, q);
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('premiums/:id')
  removePremium(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.salaryService.removePremium(id, user.tenantID);
  }

  // ── Fines / penalties (штрафы, 056_salary_penalties) ─────────────────────
  // The owner's «штрафы». Issued by владелец (director + superadmin) only —
  // admin + master are employees and never fine. Comment («за что») is
  // MANDATORY (DTO @IsNotEmpty + DB NOT NULL/CHECK). The shared contract
  // exposes these via createFine / listFines / removeFine. No consumer used
  // the previous admin-inclusive gate, so tightening breaks nothing.

  @Roles(...OWNER_ROLES)
  @Post('penalties')
  createPenalty(@CurrentUser() user: JwtPayload, @Body() dto: CreatePenaltyDto) {
    return this.salaryService.createPenalty(user.tenantID, user.userID, dto);
  }

  /**
   * Fines for the tenant (or one employee via `?userId=`). Owner-only finance
   * data — director / superadmin. Employees see their fines via the per-month
   * detail (getEmployeeMonth), not here.
   */
  @Roles(...OWNER_ROLES)
  @Get('penalties')
  listPenalties(@CurrentUser() user: JwtPayload, @Query() query: { userId?: string }) {
    return this.salaryService.listPenalties(user.tenantID, query || {});
  }

  @Roles(...OWNER_ROLES)
  @Delete('penalties/:id')
  deletePenalty(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.salaryService.deletePenalty(id, user.tenantID);
  }
}
