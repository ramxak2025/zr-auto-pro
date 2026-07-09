import { Controller, Post, Delete, Body, UseGuards } from '@nestjs/common';
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
    return this.pushService.upsertToken(user.userID, user.tenantID, dto.token, dto.platform);
  }

  @Delete('token')
  unregister(@CurrentUser() user: JwtPayload, @Body() dto: { token: string }) {
    return this.pushService.deleteToken(user.userID, dto.token);
  }
}
