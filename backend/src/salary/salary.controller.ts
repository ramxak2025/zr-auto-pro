import { Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { SalaryService } from './salary.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission, userHasPermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { CreateSalaryPaymentDto } from './dto/create-payment.dto';
import { CreatePremiumDto } from './dto/create-premium.dto';
import { CreatePenaltyDto } from './dto/create-penalty.dto';
import { CreatePayoutDto } from './dto/create-payout.dto';
import { CreateOutsidePayoutDto } from './dto/create-outside-payout.dto';
import { DecidePayoutDto } from './dto/decide-payout.dto';
import { CancelPayoutDto } from './dto/cancel-payout.dto';
import { UpdatePayoutDto } from './dto/update-payout.dto';
import { UpdatePenaltyDto } from './dto/update-penalty.dto';

// Матрица ролей АВТОРИТЕТНА (волна «права как в Битрикс24», 2026-07):
//   • 'salary_payouts_manage' (salary.payouts) — выплаты / авансы / штрафы.
//     Сид: Директор true, Админ FALSE, Мастер false — ровно прежний
//     OWNER_ROLES=['director','superadmin'] БЕЗ admin (миграция 136).
//   • 'salary_premiums_manage' (salary.premiums) — премии. Сид: Директор и
//     Админ true — прежний @Roles(director, admin, superadmin).
// Owner-class (director/superadmin) обходит проверку в PermissionsGuard.

// Охват просмотра ЧУЖОЙ зарплаты решает матрица: 'salary_view_all' → вся
// команда; иначе (и для 'salary_view' own) — только своё. Owner-class
// (director/superadmin) — всегда true через userHasPermission.
function canViewAllSalary(user: JwtPayload): boolean {
  return userHasPermission(user, 'salary_view_all');
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('salary')
export class SalaryController {
  constructor(private salaryService: SalaryService) {}

  // Listing every master's earnings + paid-out amounts reveals what every
  // colleague is getting paid — охват «все» → 'salary_view_all'. Owner-class
  // обходит через PermissionsGuard; сотрудник со «свои» видит только своё
  // через /salary/my и /salary/employee/:id/month (self-scoped ниже).
  @RequirePermission('salary_view_all')
  @Get()
  getAll(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.salaryService.getAll(user.tenantID, query);
  }

  // `getMy` filters by the JWT subject inside the service — every authenticated
  // user is allowed to see their OWN earnings. No permission gate.
  @Get('my')
  getMy(@CurrentUser() user: JwtPayload) {
    return this.salaryService.getMy(user.tenantID, user.userID);
  }

  // Same reasoning as getAll — payment history of every employee is internal
  // finance data (охват «все» → 'salary_view_all').
  @RequirePermission('salary_view_all')
  @Get('payments')
  getPayments(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.salaryService.getPayments(user.tenantID, query);
  }

  @RequirePermission('salary_payouts_manage')
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

  // ── Payouts (100_salary_payouts_and_fines + 158_salary_payout_viewed) ────

  // Владелец выдаёт ЗП / АВАНС — Round 17 (158): фиксируется СРАЗУ (расход в
  // той же транзакции), подтверждения сотрудником больше нет; сотрудник
  // получает уведомление, владелец видит «просмотрено / не просмотрено».
  @RequirePermission('salary_payouts_manage')
  @Post('payouts')
  createPayout(@CurrentUser() user: JwtPayload, @Body() dto: CreatePayoutDto) {
    return this.salaryService.createPayout(user.tenantID, user.userID, dto);
  }

  // Round 14 (149) — «Выплата вне программы»: получатель БЕЗ аккаунта
  // (маркетолог, уборщица) — свободное имя + сумма + месяц отнесения. Сразу
  // approved-расход категории «Выплаты вне программы» с period_month; прибыль
  // назначенного месяца ↓, касса — датой факта. Тот же гейт, что и выплаты.
  @RequirePermission('salary_payouts_manage')
  @Post('outside-payouts')
  createOutsidePayout(@CurrentUser() user: JwtPayload, @Body() dto: CreateOutsidePayoutDto) {
    return this.salaryService.createOutsidePayout(user.tenantID, user.userID, dto);
  }

  // ── Round 15 (153) — корректировки владельцем ────────────────────────────

  // Отмена выплаты (зафиксированной И легаси-pending). У зафиксированной —
  // сторно зеркального расхода (снапшот в аудит); строка остаётся зачёркнутой
  // с причиной.
  @RequirePermission('salary_payouts_manage')
  @Post('payouts/:id/cancel')
  cancelPayout(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: CancelPayoutDto) {
    return this.salaryService.cancelPayout(id, user.tenantID, user.userID, dto?.reason);
  }

  // Правка НЕЗАФИКСИРОВАННОЙ (легаси-pending) выплаты — сумма/комментарий.
  // Зафиксированную — отменить и выдать заново (сервис вернёт 400 с подсказкой).
  @RequirePermission('salary_payouts_manage')
  @Patch('payouts/:id')
  updatePayout(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdatePayoutDto) {
    return this.salaryService.updatePendingPayout(id, user.tenantID, user.userID, dto || {});
  }

  // Сторно LEGACY-выплаты (salary_payments): строка остаётся с reversed_at,
  // связанный расход компенсируется (по expense_id, иначе детерминированный
  // матч). Причина — query-параметр (DELETE без тела дружит с оффлайн-очередью
  // и прокси). Сервис триммит/ограничивает длину сам.
  @RequirePermission('salary_payouts_manage')
  @Delete('payments/:id')
  reversePayment(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Query('reason') reason?: string) {
    return this.salaryService.reversePayment(id, user.tenantID, user.userID, reason);
  }

  // ЛЕГАСИ-ручка решения по выплате (Round 17 / 158: подтверждения больше нет).
  // Оставлена ЖИВОЙ ради приложений старых версий: у зафиксированной выплаты
  // сервис трактует вызов как «просмотрено» и отвечает 200, у оставшихся с
  // прошлой модели pending — прежнее accept/reject. Role gate намеренно
  // открыт — авторизация получателя внутри сервиса, как у confirmPayment.
  @Post('payouts/:id/decide')
  decidePayout(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: DecidePayoutDto) {
    return this.salaryService.decidePayout(id, user.tenantID, user.userID, dto.decision);
  }

  // Round 17 (158) — «просмотрено»: получатель закрыл уведомление о выплате.
  // Денег не двигает; авторизация получателя — внутри сервиса (WHERE
  // employee_id), поэтому role gate открыт, как у decide/confirm.
  @Post('payouts/:id/viewed')
  markPayoutViewed(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.salaryService.markPayoutViewed(id, user.tenantID, user.userID);
  }

  // Round 17 (158) — фиксация ЛЕГАСИ pending-выплаты владельцем: создаёт
  // зеркальный расход и переводит строку в «зафиксирована». Нужна только для
  // строк, доставшихся от модели с подтверждением (новые выплаты фиксируются
  // сразу). Тот же денежный гейт, что и у выдачи.
  @RequirePermission('salary_payouts_manage')
  @Post('payouts/:id/settle')
  settlePayout(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.salaryService.settlePayout(id, user.tenantID, user.userID);
  }

  // List payouts + statuses. Owner (director/superadmin) sees the whole tenant;
  // an employee (admin/master) is scoped to their OWN payouts — we force the
  // employeeId filter to themselves so they can't read a colleague's or dump
  // the tenant. Same self-scoping pattern as listPremiums.
  @Get('payouts')
  listPayouts(
    @CurrentUser() user: JwtPayload,
    @Query()
    query: {
      employeeId?: string;
      status?: 'pending' | 'accepted' | 'rejected' | 'cancelled';
      monthYear?: string;
      /** 158 — только НЕ просмотренные получателем ('true'/'1' в query). */
      unviewed?: string;
    },
  ) {
    // Охват «все» → 'salary_view_all' (owner-class тоже true); иначе self-scope.
    const privileged = canViewAllSalary(user);
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
    // «Все» → 'salary_view_all' может смотреть любого; иначе — только себя.
    const privileged = canViewAllSalary(user);
    const target = privileged ? employeeId : user.userID;
    return this.salaryService.getEmployeeMonth(user.tenantID, target, month);
  }

  // ── Premiums ───────────────────────────────────────────────────────────

  @RequirePermission('salary_premiums_manage')
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
    // history. Охват «все» → 'salary_view_all' (owner-class тоже) keeps the full view.
    const privileged = canViewAllSalary(user);
    const q = { ...(query || {}) };
    if (!privileged) q.userId = user.userID;
    return this.salaryService.listPremiums(user.tenantID, q);
  }

  @RequirePermission('salary_premiums_manage')
  @Delete('premiums/:id')
  removePremium(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.salaryService.removePremium(id, user.tenantID);
  }

  // ── Fines / penalties (штрафы, 056_salary_penalties) ─────────────────────
  // The owner's «штрафы» — 'salary_payouts_manage' (сид: Директор true, Админ
  // FALSE — ровно прежний OWNER_ROLES-гейт без admin). Comment («за что») is
  // MANDATORY (DTO @IsNotEmpty + DB NOT NULL/CHECK). The shared contract
  // exposes these via createFine / listFines / removeFine.

  @RequirePermission('salary_payouts_manage')
  @Post('penalties')
  createPenalty(@CurrentUser() user: JwtPayload, @Body() dto: CreatePenaltyDto) {
    return this.salaryService.createPenalty(user.tenantID, user.userID, dto);
  }

  /**
   * Fines for the tenant (or one employee via `?userId=`). Owner-only finance
   * data — 'salary_payouts_manage'. Employees see their fines via the
   * per-month detail (getEmployeeMonth), not here.
   */
  @RequirePermission('salary_payouts_manage')
  @Get('penalties')
  listPenalties(@CurrentUser() user: JwtPayload, @Query() query: { userId?: string }) {
    return this.salaryService.listPenalties(user.tenantID, query || {});
  }

  // Round 15 (153) — правка штрафа (сумма/причина) с аудитом before/after.
  // Пересчёт не нужен: штраф суммируется на лету, ничего не запечено.
  @RequirePermission('salary_payouts_manage')
  @Patch('penalties/:id')
  updatePenalty(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdatePenaltyDto) {
    return this.salaryService.updatePenalty(id, user.tenantID, user.userID, dto || {});
  }

  @RequirePermission('salary_payouts_manage')
  @Delete('penalties/:id')
  deletePenalty(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.salaryService.deletePenalty(id, user.tenantID, user.userID);
  }
}
