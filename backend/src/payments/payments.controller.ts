import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentSettingsDto } from './dto/update-payment-settings.dto';

/**
 * Эквайринг + СБП (acquiring + Faster Payments) — tenant-scoped from the JWT.
 *
 * AUTHENTICATED controller: JwtAuthGuard is applied here at the class level, the
 * same opt-in pattern every other controller uses (there is NO global JWT guard
 * in this project — only RateLimitGuard is global in main.ts). The PUBLIC webhook
 * lives in a SEPARATE controller (payments-webhook.controller.ts) that simply
 * does NOT apply JwtAuthGuard — that is how the webhook is reachable without a
 * token, with the global JwtAuthGuard left fully intact for everything else.
 *
 * Matrix-gated (миграция 136; owner-class director/superadmin bypasses via
 * PermissionsGuard): settings → 'settings_manage'; `create` is part of the
 * check flow → 'checks_create' (master seed true — the cash screen keeps
 * working); `GET :id` (poll) → 'checks_view' (tenant-scoped in service).
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  // ─── Config ('settings_manage'). Literal routes BEFORE ':id'. ─────────────
  @RequirePermission('settings_manage')
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.payments.getSettings(user.tenantID);
  }

  @RequirePermission('settings_manage')
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdatePaymentSettingsDto) {
    return this.payments.updateSettings(user.tenantID, dto);
  }

  // ─── Create ('checks_create' — check flow) ────────────────────────────────
  @RequirePermission('checks_create')
  @Post('create')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePaymentDto) {
    return this.payments.create(user, dto);
  }

  // ─── Poll status ('checks_view'; tenant-scoped) ───────────────────────────
  @RequirePermission('checks_view')
  @Get(':id')
  getById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.payments.getById(user.tenantID, id);
  }
}
