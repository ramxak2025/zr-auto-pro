import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, IsIn } from 'class-validator';
import { JournalService } from './journal.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

class WarehouseDocsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  // 'customer_return' was added to JournalService + shared JournalDoc + the mobile
  // chips in 479ff21 but NOT here — so ?type=customer_return failed @IsIn → 400 and
  // broke the «Возврат клиента» filter. Keep this whitelist in sync with the kinds
  // JournalService.getWarehouseDocs can return.
  // 'supplier_refund' — ЛОГИЧЕСКИЙ фильтр (Round 14): сервер отдаёт только
  // строки-возвраты, но в проводе их kind = 'supplier_payment' + isRefund=true
  // (совместимость со старыми бандлами — см. JournalDoc.isRefund).
  @IsIn([
    'purchase',
    'return_to_supplier',
    'customer_return',
    'defect_transfer',
    'writeoff',
    'supplier_payment',
    'supplier_refund',
    'used_purchase',
  ])
  type?:
    | 'purchase'
    | 'return_to_supplier'
    | 'customer_return'
    | 'defect_transfer'
    | 'writeoff'
    | 'supplier_payment'
    | 'supplier_refund'
    | 'used_purchase';
}

// All financial documents — держатели 'financial_reports' (ROLE-ONLY, волна
// «права как в Битрикс24», 2026-07: @Roles(d,a,sa) снят, матрица авторитетна;
// сиды системных ролей — мастер false, админ true — дают поведение 1:1).
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('financial_reports')
@Controller('journal')
export class JournalController {
  constructor(private journal: JournalService) {}

  @Get('warehouse-docs')
  warehouseDocs(@CurrentUser() user: JwtPayload, @Query() q: WarehouseDocsQueryDto) {
    return this.journal.getWarehouseDocs(user.tenantID, q);
  }
}
