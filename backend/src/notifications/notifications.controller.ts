import { Controller, Get, Post, Put, Body, Param, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { UpdatePreferencesDto, CreateBroadcastDto } from './dto/notifications.dto';

/**
 * In-app notification settings + broadcast read/seen surface.
 *
 * Every route sits under the GLOBAL JwtAuthGuard (main.ts). RolesGuard is added
 * here so the @Roles('superadmin') on the admin controller below is enforced.
 *   * preferences  — any authenticated user manages their own mute list.
 *   * broadcasts   — any authenticated user reads/acks broadcasts addressed to
 *                    them (in practice directors, who are the fan-out targets).
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  // ─── Preferences ───────────────────────────────────────────────────────────

  @Get('preferences')
  getPreferences(@CurrentUser() user: JwtPayload) {
    return this.notifications.getPreferences(user.userID);
  }

  @Put('preferences')
  updatePreferences(@CurrentUser() user: JwtPayload, @Body() dto: UpdatePreferencesDto) {
    return this.notifications.updatePreferences(user.userID, dto.muted);
  }

  // ─── Broadcasts (read side) ──────────────────────────────────────────────────

  @Get('broadcasts/unseen')
  listUnseenBroadcasts(@CurrentUser() user: JwtPayload) {
    return this.notifications.listUnseenBroadcasts(user.userID);
  }

  @Post('broadcasts/:id/seen')
  markBroadcastSeen(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notifications.markBroadcastSeen(user.userID, id);
  }
}

/**
 * Superadmin-only broadcast authoring. Separate controller because the route
 * lives under `/admin`, not `/notifications`. Same global JwtAuthGuard; the
 * @Roles('superadmin') below is enforced by RolesGuard.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminBroadcastController {
  constructor(private notifications: NotificationsService) {}

  @Roles('superadmin')
  @Post('broadcast')
  createBroadcast(@CurrentUser() user: JwtPayload, @Body() dto: CreateBroadcastDto) {
    return this.notifications.broadcast(user.userID, dto);
  }
}
