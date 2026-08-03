import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuditService, AuditActor } from '../tenants/audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { AllowNoTenant } from '../common/decorators/allow-no-tenant.decorator';
import { UpdatePreferencesDto, UpdateNotificationSettingsDto, CreateBroadcastDto } from './dto/notifications.dto';

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

  // @AllowNoTenant: both preference writes key off userID and touch tables with
  // NO tenant_id (notification_mutes, notification_settings — both deliberately
  // outside RLS, see migrations 066/112/151), so they can never insert a row
  // under the phantom sentinel tenant. Without this, a tenant-less superadmin
  // (the owner on his own iPhone) loads «Уведомления» fine and then gets
  // «Действие недоступно без выбранного автосервиса» on EVERY toggle.
  @AllowNoTenant()
  @Put('preferences')
  updatePreferences(@CurrentUser() user: JwtPayload, @Body() dto: UpdatePreferencesDto) {
    return this.notifications.updatePreferences(user.userID, dto.muted);
  }

  // ─── Global settings (151) ─────────────────────────────────────────────────
  // Master switch, quiet hours and sound — orthogonal to the per-category mute
  // list above, so they live on their own route and their own row.

  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.notifications.getSettings(user.userID);
  }

  @AllowNoTenant()
  @Put('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateNotificationSettingsDto) {
    return this.notifications.updateSettings(user.userID, dto);
  }

  // ─── Broadcasts (read side) ──────────────────────────────────────────────────

  @Get('broadcasts/unseen')
  listUnseenBroadcasts(@CurrentUser() user: JwtPayload) {
    // tenantID drives the 096 segment-recipient match (target_all broadcasts
    // ignore it and still reach everyone).
    return this.notifications.listUnseenBroadcasts(user.userID, user.tenantID);
  }

  @Post('broadcasts/:id/seen')
  markBroadcastSeen(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notifications.markBroadcastSeen(user.userID, id);
  }
}

/**
 * Superadmin-only broadcast authoring, history and revoke. Separate controller
 * because the route lives under `/admin`, not `/notifications`. Same global
 * JwtAuthGuard; the @Roles('superadmin') below is enforced by RolesGuard.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminBroadcastController {
  constructor(
    private notifications: NotificationsService,
    private audit: AuditService,
  ) {}

  /** Build the audit actor for a superadmin action (name resolved best-effort). */
  private async actor(user: JwtPayload): Promise<AuditActor> {
    return { userId: user.userID, name: await this.audit.resolveActorName(user.userID) };
  }

  @Roles('superadmin')
  @Post('broadcast')
  createBroadcast(@CurrentUser() user: JwtPayload, @Body() dto: CreateBroadcastDto) {
    return this.notifications.broadcast(user.userID, dto);
  }

  /** Full broadcast history, newest-first, with per-broadcast seen counts. */
  @Roles('superadmin')
  @Get('broadcasts')
  listBroadcasts() {
    return this.notifications.listBroadcasts();
  }

  /** Revoke a broadcast — it instantly stops surfacing to every director. */
  @Roles('superadmin')
  @Delete('broadcast/:id')
  async cancelBroadcast(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.notifications.cancelBroadcast(id, await this.actor(user));
  }
}
