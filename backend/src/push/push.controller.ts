import { Controller, Post, Delete, Body, UseGuards } from '@nestjs/common';
import { PushService } from './push.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('token')
  register(@CurrentUser() user: JwtPayload, @Body() dto: { token: string; platform: 'ios' | 'android' }) {
    return this.pushService.upsertToken(user.userID, dto.token, dto.platform);
  }

  @Delete('token')
  unregister(@CurrentUser() user: JwtPayload, @Body() dto: { token: string }) {
    return this.pushService.deleteToken(user.userID, dto.token);
  }
}
