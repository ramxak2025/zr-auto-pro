import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateSalaryPaymentDto } from './dto/create-payment.dto';
import { CreatePremiumDto } from './dto/create-premium.dto';
import { CreatePenaltyDto } from './dto/create-penalty.dto';

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

  // ── Penalties (штрафы, 056_salary_penalties) ────────────────────────────

  @Roles('director', 'admin', 'superadmin')
  @Post('penalties')
  createPenalty(@CurrentUser() user: JwtPayload, @Body() dto: CreatePenaltyDto) {
    return this.salaryService.createPenalty(user.tenantID, user.userID, dto);
  }

  /**
   * Penalties for the tenant (or one employee via `?userId=`). Same internal-
   * finance sensitivity as payments — director / admin / superadmin only.
   */
  @Roles('director', 'admin', 'superadmin')
  @Get('penalties')
  listPenalties(@CurrentUser() user: JwtPayload, @Query() query: { userId?: string }) {
    return this.salaryService.listPenalties(user.tenantID, query || {});
  }

  @Roles('director', 'admin', 'superadmin')
  @Delete('penalties/:id')
  deletePenalty(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.salaryService.deletePenalty(id, user.tenantID);
  }
}
