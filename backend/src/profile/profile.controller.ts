import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * «Мой профиль» — self profile edit, self password change, and the owner-class
 * approval queue for employee profile-change requests.
 *
 * JwtAuthGuard + RolesGuard apply to the whole controller (mirrors DebtsController).
 * Endpoints WITHOUT a @Roles decorator are open to any authenticated user (the
 * self actions); the review-queue endpoints are restricted to владелец
 * (director / superadmin). Role branching for "apply directly vs create a
 * request" lives in ProfileService, keyed off the caller's own role.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('profile')
export class ProfileController {
  constructor(private profile: ProfileService) {}

  // ─── Self (any authenticated user) ──────────────────────────────────────

  /**
   * Edit own ФИО / телефон / аватар. director/superadmin → applied directly;
   * admin/master → creates a pending change-request. Response discriminates via
   * `status` ('applied' | 'requested').
   */
  @Patch()
  updateProfile(@CurrentUser() user: JwtPayload, @Body() dto: UpdateProfileDto) {
    return this.profile.updateProfile(user, dto);
  }

  /** Change own password — self-service for every role. */
  @Post('password')
  changePassword(@CurrentUser() user: JwtPayload, @Body() dto: ChangePasswordDto) {
    return this.profile.changePassword(user, dto);
  }

  /**
   * The caller's own current pending request (or null). Literal route declared
   * before the parameterised owner routes below so it is never shadowed.
   */
  @Get('change-requests/mine')
  myChangeRequest(@CurrentUser() user: JwtPayload) {
    return this.profile.getMyChangeRequest(user.userID);
  }

  // ─── Owner review queue (director / superadmin) ─────────────────────────

  @Roles('director', 'superadmin')
  @Get('change-requests')
  listChangeRequests(@CurrentUser() user: JwtPayload) {
    return this.profile.listChangeRequests(user.tenantID);
  }

  @Roles('director', 'superadmin')
  @Post('change-requests/:id/approve')
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.profile.approveChangeRequest(user, id);
  }

  @Roles('director', 'superadmin')
  @Post('change-requests/:id/reject')
  reject(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.profile.rejectChangeRequest(user, id);
  }
}
