import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

/**
 * «Мой профиль» — self profile edit, self password change, and the approval
 * queue for employee profile-change requests.
 *
 * Guards apply to the whole controller (mirrors DebtsController). Undecorated
 * endpoints are open to any authenticated user (the self actions); the
 * review-queue endpoints ride the 'employees_approve_profile' matrix cell
 * (employees.approveProfile, миграция 136) — owner-only: сид «Администратора»
 * false (сегодня @Roles(d,sa) БЕЗ admin — 1:1). Owner-class (director/
 * superadmin) bypasses via PermissionsGuard. Role branching for "apply directly
 * vs create a request" lives in ProfileService, keyed off the caller's own role.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
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

  // ─── Review queue ('employees_approve_profile'; сид Админ=false) ────────

  @RequirePermission('employees_approve_profile')
  @Get('change-requests')
  listChangeRequests(@CurrentUser() user: JwtPayload) {
    return this.profile.listChangeRequests(user.tenantID);
  }

  @RequirePermission('employees_approve_profile')
  @Post('change-requests/:id/approve')
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.profile.approveChangeRequest(user, id);
  }

  @RequirePermission('employees_approve_profile')
  @Post('change-requests/:id/reject')
  reject(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.profile.rejectChangeRequest(user, id);
  }
}
