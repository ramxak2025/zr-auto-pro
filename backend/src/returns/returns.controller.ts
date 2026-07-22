import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ReturnsService, CreateReturnDto } from './returns.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// Returns are a financial event. Masters MUST NOT issue refunds on their own
// orders by default. ROLE-ONLY (волна «права как в Битрикс24», 2026-07):
// @Roles(d,a,sa) снят, матрица авторитетна —
//   • список возвратов — 'checks_view_all' (журнальный охват «все чеки»);
//   • оформить возврат — 'payment_edit' (денежная операция над проведённым
//     чеком; та же ячейка, что правка оплаты закрытого чека).
// Сиды системных ролей (мастер false/false, админ true/true) — поведение 1:1.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('returns')
export class ReturnsController {
  constructor(private returnsService: ReturnsService) {}

  @RequirePermission('checks_view_all')
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: { from?: string; to?: string }) {
    return this.returnsService.list(user.tenantID, query);
  }

  @RequirePermission('payment_edit')
  @Post(':checkId')
  create(@Param('checkId') checkId: string, @CurrentUser() user: JwtPayload, @Body() dto: CreateReturnDto) {
    return this.returnsService.createReturn(user.tenantID, user.userID, checkId, dto);
  }
}
