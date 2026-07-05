import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { InstallmentsService } from './installments.service';
import { PayInstallmentDto } from './dto/pay-installment.dto';
import { PayoffInstallmentDto } from './dto/payoff-installment.dto';
import { UpdateInstallmentDto } from './dto/update-installment.dto';
import { UpdateInstallmentReminderSettingsDto } from './dto/update-reminder-settings.dto';

/**
 * Рассрочка (installments) — tenant-scoped from the JWT. Replaces the old manual
 * «Дебиторка» (debts/) as the primary sell-on-credit flow.
 *
 * Reads (list / client ledger) are open to any authenticated tenant user (no
 * @Roles ⇒ RolesGuard passes everyone), mirroring /debts and /checks GET so a
 * cashier can see who owes. Every mutation (pay / payoff / reschedule) and the
 * reminder-settings + widget are owner-class only. The PLAN ITSELF is created by
 * ChecksService when a check is sold with paymentMethod 'installment' (gated by
 * the `sell_installment` permission there) — there is no create endpoint here.
 *
 * Literal routes are declared BEFORE the `:planId` param routes so they are never
 * swallowed by the parameter matcher.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('installments')
export class InstallmentsController {
  constructor(private installments: InstallmentsService) {}

  // ─── Reads ──────────────────────────────────────────────────────────────
  /** «Рассрочка» list. ?status=open|closed|overdue|all (default open). */
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: { status?: string }) {
    return this.installments.list(user.tenantID, query);
  }

  /** Главная widget: due-soon (next N days) + overdue. Owner/admin only. */
  @Roles('director', 'admin', 'superadmin')
  @Get('widget')
  widget(@CurrentUser() user: JwtPayload, @Query('days') days?: string) {
    return this.installments.widget(user.tenantID, days !== undefined ? parseInt(days, 10) : 3);
  }

  // ─── Reminder settings (owner-class) ─────────────────────────────────────
  @Roles('director', 'admin', 'superadmin')
  @Get('reminder-settings')
  getReminderSettings(@CurrentUser() user: JwtPayload) {
    return this.installments.getReminderSettings(user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch('reminder-settings')
  updateReminderSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateInstallmentReminderSettingsDto) {
    return this.installments.updateReminderSettings(user.tenantID, dto);
  }

  /** Manual «отправить напоминания сейчас» (owner-class). */
  @Roles('director', 'admin', 'superadmin')
  @Post('reminders/send')
  sendReminders(@CurrentUser() user: JwtPayload) {
    return this.installments.sendRemindersNow(user.tenantID);
  }

  /** One client's plans + payment ledger (client card section). */
  @Get('client/:clientId')
  clientLedger(@CurrentUser() user: JwtPayload, @Param('clientId') clientId: string) {
    return this.installments.clientLedger(user.tenantID, clientId);
  }

  // ─── Operations (owner-class) ────────────────────────────────────────────
  /** Record a partial payment; reduces remaining, optionally moves the next date. */
  @Roles('director', 'admin', 'superadmin')
  @Post(':planId/pay')
  pay(@CurrentUser() user: JwtPayload, @Param('planId') planId: string, @Body() dto: PayInstallmentDto) {
    return this.installments.pay(user, planId, dto);
  }

  /** Pay off the whole remaining at once (close the plan). Body опционален — {method?} (119). */
  @Roles('director', 'admin', 'superadmin')
  @Post(':planId/payoff')
  payoff(@CurrentUser() user: JwtPayload, @Param('planId') planId: string, @Body() dto: PayoffInstallmentDto) {
    return this.installments.payoff(user, planId, dto?.method);
  }

  /** Reschedule the next payment date and/or edit the comment. */
  @Roles('director', 'admin', 'superadmin')
  @Patch(':planId')
  update(@CurrentUser() user: JwtPayload, @Param('planId') planId: string, @Body() dto: UpdateInstallmentDto) {
    return this.installments.update(user, planId, dto);
  }
}
