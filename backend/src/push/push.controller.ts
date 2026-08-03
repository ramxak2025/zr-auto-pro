import { Controller, Post, Get, Delete, Body, UseGuards } from '@nestjs/common';
import { PushService } from './push.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AllowNoTenant } from '../common/decorators/allow-no-tenant.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

// push_tokens has NO tenant_id column (it references user_id only), so token
// registration never FK-violates on the sentinel — and a superadmin must still
// receive operator push. Legitimate tenant-less write → exempt from the block.
@AllowNoTenant()
@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('token')
  register(@CurrentUser() user: JwtPayload, @Body() dto: { token: string; platform: 'ios' | 'android' }) {
    // Returns { registered: false } when the hijack guard refused the row —
    // the client MUST NOT treat a 200 as "subscribed" any more.
    return this.pushService.upsertToken(user.userID, user.tenantID, dto.token, dto.platform);
  }

  @Delete('token')
  unregister(@CurrentUser() user: JwtPayload, @Body() dto: { token: string }) {
    return this.pushService.deleteToken(user.userID, dto.token);
  }

  /**
   * Diagnostics (Round 14). The caller's own devices, tokens masked. Answers
   * "зарегистрирован ли телефон вообще" without any guessing.
   */
  @Get('tokens')
  tokens(@CurrentUser() user: JwtPayload) {
    return this.pushService.listTokens(user.userID);
  }

  /**
   * Send a test push TO YOURSELF and get the RAW Expo verdict back — tickets,
   * top-level errors and (after a short wait) the delivery receipts, which is
   * the only place APNs failures are visible. Self-targeted only: there is no
   * recipient parameter, so this can never be used to push at someone else.
   *
   * Takes a few seconds by design — it waits for the receipt instead of
   * reporting a meaningless "ok".
   */
  @Post('test')
  test(@CurrentUser() user: JwtPayload) {
    return this.pushService.sendTestPush(user.userID);
  }
}
