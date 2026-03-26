import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { CallsService } from './calls.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('calls')
export class CallsController {
  constructor(private callsService: CallsService) {}

  @Get()
  getCalls(@CurrentUser() user: JwtPayload, @Query() query: { date?: string; dateFrom?: string; dateTo?: string }) {
    return this.callsService.getCalls(user.tenantID, query);
  }

  @Get('client/:clientId')
  getClientCalls(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
    @Query() query: { dateFrom?: string; dateTo?: string },
  ) {
    return this.callsService.getClientCalls(user.tenantID, clientId, query);
  }

  @Get('client/:clientId/sms')
  getClientSmsHistory(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
  ) {
    return this.callsService.getClientSmsHistory(user.tenantID, clientId);
  }

  @Get('recording')
  getRecordingUrl(
    @CurrentUser() user: JwtPayload,
    @Query('url') url: string,
  ) {
    return this.callsService.getRecordingUrl(user.tenantID, url);
  }
}
