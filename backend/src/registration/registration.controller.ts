import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { AuditService, AuditActor } from '../tenants/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { RegistrationRateLimitGuard } from './registration-rate-limit.guard';
import { SubmitRegistrationDto } from './dto/submit-registration.dto';
import { ApproveRegistrationDto, RejectRegistrationDto } from './dto/review-registration.dto';

/**
 * PUBLIC self-service registration submit.
 *
 * UNAUTHENTICATED by design — mirrors /auth/register: there is NO global
 * JwtAuthGuard in this app (only RateLimitGuard is applied globally in main.ts),
 * so a route is public simply by NOT declaring @UseGuards(JwtAuthGuard). This
 * controller deliberately declares none.
 *
 * Abuse surface is covered by TWO layers: the global RateLimitGuard (anonymous
 * write bucket) PLUS the dedicated strict RegistrationRateLimitGuard (5/min per
 * IP) below. The global ValidationPipe (whitelist:true) strips unknown fields.
 */
@Controller('registration-requests')
export class RegistrationController {
  constructor(private registrationService: RegistrationService) {}

  @UseGuards(RegistrationRateLimitGuard)
  @Post()
  submit(@Body() dto: SubmitRegistrationDto) {
    return this.registrationService.submit(dto);
  }
}

/**
 * SUPERADMIN registration-request review, under /admin/* like AdminAuditController.
 * Same JwtAuthGuard + RolesGuard('superadmin') pattern as the rest of /admin.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin/registration-requests')
export class AdminRegistrationController {
  constructor(
    private registrationService: RegistrationService,
    private audit: AuditService,
  ) {}

  /** Build the audit actor for a superadmin action (name resolved best-effort). */
  private async actor(user: JwtPayload): Promise<AuditActor> {
    return { userId: user.userID, name: await this.audit.resolveActorName(user.userID) };
  }

  @Roles('superadmin')
  @Get()
  list(@Query('status') status?: string) {
    return this.registrationService.list(status);
  }

  @Roles('superadmin')
  @Post(':id/approve')
  async approve(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ApproveRegistrationDto) {
    return this.registrationService.approve(id, dto, await this.actor(user));
  }

  @Roles('superadmin')
  @Post(':id/reject')
  async reject(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: RejectRegistrationDto) {
    return this.registrationService.reject(id, dto, await this.actor(user));
  }
}
