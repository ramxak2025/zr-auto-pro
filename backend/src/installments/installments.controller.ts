import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { InstallmentsService } from './installments.service';
import { CreateGuarantorDto } from './dto/create-guarantor.dto';
import { PayInstallmentDto } from './dto/pay-installment.dto';
import { PayoffInstallmentDto } from './dto/payoff-installment.dto';
import { UpdateInstallmentDto } from './dto/update-installment.dto';
import { UpdateInstallmentReminderSettingsDto } from './dto/update-reminder-settings.dto';

/**
 * Рассрочка (installments) — tenant-scoped from the JWT. Replaces the old manual
 * «Дебиторка» (debts/) as the primary sell-on-credit flow.
 *
 * Reads (list / client ledger) are open to any authenticated tenant user
 * (undecorated ⇒ guards pass everyone), mirroring /debts and /checks GET so a
 * cashier can see who owes. Every mutation (pay / payoff / reschedule) and the
 * reminder-settings + widget are gated by the 'debts_manage' matrix cell
 * (clients.debts, миграция 136) — the matrix is authoritative; owner-class
 * (director/superadmin) bypasses via PermissionsGuard. The PLAN ITSELF is
 * created by ChecksService when a check is sold with paymentMethod 'installment'
 * (gated by the `sell_installment` permission there) — no create endpoint here.
 *
 * Literal routes are declared BEFORE the `:planId` param routes so they are never
 * swallowed by the parameter matcher.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('installments')
export class InstallmentsController {
  constructor(private installments: InstallmentsService) {}

  // ─── Reads ──────────────────────────────────────────────────────────────
  /** «Рассрочка» list. ?status=open|closed|overdue|all (default open). */
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: { status?: string }) {
    return this.installments.list(user.tenantID, query, user);
  }

  /** Главная widget: due-soon (next N days) + overdue. 'debts_manage' only. */
  @RequirePermission('debts_manage')
  @Get('widget')
  widget(@CurrentUser() user: JwtPayload, @Query('days') days?: string) {
    return this.installments.widget(user.tenantID, days !== undefined ? parseInt(days, 10) : 3, user);
  }

  // ─── Reminder settings ('debts_manage') ──────────────────────────────────
  @RequirePermission('debts_manage')
  @Get('reminder-settings')
  getReminderSettings(@CurrentUser() user: JwtPayload) {
    return this.installments.getReminderSettings(user.tenantID);
  }

  @RequirePermission('debts_manage')
  @Patch('reminder-settings')
  updateReminderSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateInstallmentReminderSettingsDto) {
    return this.installments.updateReminderSettings(user.tenantID, dto);
  }

  /** Manual «отправить напоминания сейчас» ('debts_manage'). */
  @RequirePermission('debts_manage')
  @Post('reminders/send')
  sendReminders(@CurrentUser() user: JwtPayload) {
    return this.installments.sendRemindersNow(user.tenantID);
  }

  /** One client's plans + payment ledger (client card section). */
  @Get('client/:clientId')
  clientLedger(@CurrentUser() user: JwtPayload, @Param('clientId') clientId: string) {
    return this.installments.clientLedger(user.tenantID, clientId);
  }

  // ─── Operations ('debts_manage') ─────────────────────────────────────────
  /** Record a partial payment; reduces remaining, optionally moves the next date. */
  @RequirePermission('debts_manage')
  @Post(':planId/pay')
  pay(@CurrentUser() user: JwtPayload, @Param('planId') planId: string, @Body() dto: PayInstallmentDto) {
    return this.installments.pay(user, planId, dto);
  }

  /** Pay off the whole remaining at once (close the plan). Body опционален — {method?} (119). */
  @RequirePermission('debts_manage')
  @Post(':planId/payoff')
  payoff(@CurrentUser() user: JwtPayload, @Param('planId') planId: string, @Body() dto: PayoffInstallmentDto) {
    return this.installments.payoff(user, planId, dto?.method);
  }

  /**
   * Reschedule the next payment date and/or edit the comment. Явный перенос
   * даты пишет историю в installment_reschedules (rescheduleReason — причина,
   * опциональна); старый контракт (nextPaymentDate/comment) работает как раньше.
   */
  @RequirePermission('debts_manage')
  @Patch(':planId')
  update(@CurrentUser() user: JwtPayload, @Param('planId') planId: string, @Body() dto: UpdateInstallmentDto) {
    return this.installments.update(user, planId, dto);
  }

  // ─── Guarantors (Round 13 #6, 'debts_manage') ────────────────────────────
  /** Добавить поручителя к плану. Возвращает обновлённый план. */
  @RequirePermission('debts_manage')
  @Post(':planId/guarantors')
  addGuarantor(@CurrentUser() user: JwtPayload, @Param('planId') planId: string, @Body() dto: CreateGuarantorDto) {
    return this.installments.addGuarantor(user, planId, dto);
  }

  /** Удалить поручителя. Возвращает обновлённый план. */
  @RequirePermission('debts_manage')
  @Delete(':planId/guarantors/:id')
  removeGuarantor(@CurrentUser() user: JwtPayload, @Param('planId') planId: string, @Param('id') id: string) {
    return this.installments.removeGuarantor(user, planId, id);
  }
}
