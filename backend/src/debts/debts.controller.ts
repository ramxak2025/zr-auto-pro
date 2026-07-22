import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { DebtsService } from './debts.service';
import { ChargeDebtDto } from './dto/charge-debt.dto';
import { PaymentDebtDto } from './dto/payment-debt.dto';

/**
 * Дебиторка / долги клиентов — tenant-scoped from the JWT.
 *
 * Reads (per-client ledger / debtors overview) are open to ANY authenticated
 * user in the tenant (undecorated ⇒ guards pass everyone), consistent with
 * /clients and /checks GET being role-open so a cashier can see who owes money.
 * Every MUTATION that moves the ledger (charge / payment / delete) is gated by
 * the 'debts_manage' matrix cell (clients.debts, миграция 136) — the matrix is
 * authoritative; owner-class (director/superadmin) bypasses via PermissionsGuard.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('debts')
export class DebtsController {
  constructor(private debts: DebtsService) {}

  // ─── Reads (literal route first so 'debtors' isn't captured elsewhere) ──
  @Get('debtors')
  debtors(@CurrentUser() user: JwtPayload) {
    return this.debts.debtors(user.tenantID);
  }

  @Get('client/:clientId')
  clientLedger(@CurrentUser() user: JwtPayload, @Param('clientId') clientId: string) {
    return this.debts.clientLedger(user.tenantID, clientId);
  }

  // ─── Mutations ('debts_manage') ────────────────────────────────────────
  @RequirePermission('debts_manage')
  @Post('charge')
  charge(@CurrentUser() user: JwtPayload, @Body() dto: ChargeDebtDto) {
    return this.debts.charge(user, dto);
  }

  @RequirePermission('debts_manage')
  @Post('payment')
  payment(@CurrentUser() user: JwtPayload, @Body() dto: PaymentDebtDto) {
    return this.debts.payment(user, dto);
  }

  @RequirePermission('debts_manage')
  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.debts.remove(user.tenantID, id);
  }
}
