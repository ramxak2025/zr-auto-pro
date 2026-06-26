import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
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
 * Config (settings) is owner-class only. `create` is gated to the cashier-capable
 * set (director/admin/master/superadmin) — the same roles that work the cash
 * screen and create checks. `GET :id` (poll) is open to any tenant user but is
 * tenant-scoped so it only ever returns this tenant's payment.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  // ─── Config (owner-class only). Literal routes BEFORE ':id'. ──────────────
  @Roles('director', 'admin', 'superadmin')
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.payments.getSettings(user.tenantID);
  }

  @Roles('director', 'admin', 'superadmin')
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdatePaymentSettingsDto) {
    return this.payments.updateSettings(user.tenantID, dto);
  }

  // ─── Create (cashier-capable roles) ───────────────────────────────────────
  @Roles('director', 'admin', 'master', 'superadmin')
  @Post('create')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePaymentDto) {
    return this.payments.create(user, dto);
  }

  // ─── Poll status (any tenant user; tenant-scoped) ─────────────────────────
  @Get(':id')
  getById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.payments.getById(user.tenantID, id);
  }
}
