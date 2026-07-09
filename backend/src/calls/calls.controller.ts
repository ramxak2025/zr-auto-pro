import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { CallsService } from './calls.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// Calls = customer-comms data (call logs, SMS history, recording URLs).
// ROLE-ONLY (консолидация 2026-07): раньше весь контроллер был @Roles-only
// (director/admin/superadmin), а ключи calls_view / calls_listen были мёртвыми.
// Теперь enforcement per-route по permission-ключам:
//   • view   — список звонков / звонки клиента / SMS-история → 'calls_view';
//   • listen — URL записи разговора (прослушать) → 'calls_listen'.
// Owner-class (director/admin/superadmin) обходит гейты через PermissionsGuard.
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('calls')
export class CallsController {
  constructor(private callsService: CallsService) {}

  @RequirePermission('calls_view')
  @Get()
  getCalls(@CurrentUser() user: JwtPayload, @Query() query: { date?: string; dateFrom?: string; dateTo?: string }) {
    return this.callsService.getCalls(user.tenantID, query);
  }

  @RequirePermission('calls_view')
  @Get('client/:clientId')
  getClientCalls(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
    @Query() query: { dateFrom?: string; dateTo?: string },
  ) {
    return this.callsService.getClientCalls(user.tenantID, clientId, query);
  }

  @RequirePermission('calls_view')
  @Get('client/:clientId/sms')
  getClientSmsHistory(@CurrentUser() user: JwtPayload, @Param('clientId') clientId: string) {
    return this.callsService.getClientSmsHistory(user.tenantID, clientId);
  }

  @RequirePermission('calls_listen')
  @Get('recording')
  getRecordingUrl(@CurrentUser() user: JwtPayload, @Query('url') url: string) {
    return this.callsService.getRecordingUrl(user.tenantID, url);
  }
}
