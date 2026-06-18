import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { UpsertIntegrationDto } from './dto/upsert-integration.dto';
import { UpsertPlatformLinkDto } from './dto/upsert-platform-link.dto';
import { UpdateReviewSettingsDto } from './dto/update-review-settings.dto';
import { UpdateReminderSettingsDto } from './dto/update-reminder-settings.dto';
import { ReminderService } from './reminder.service';

@Controller('marketing')
export class MarketingController {
  constructor(
    private marketingService: MarketingService,
    private reminderService: ReminderService,
  ) {}

  // ─── Dashboard (protected) ────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('dashboard')
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getDashboard(user.tenantID);
  }

  // ─── Reviews list (protected) ─────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('reviews')
  getReviews(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.marketingService.getReviews(user.tenantID, query);
  }

  // ─── Alerts (protected) ───────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('alerts')
  getAlerts(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getAlerts(user.tenantID);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('alerts/:id/read')
  markAlertRead(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.marketingService.markAlertRead(id, user.tenantID);
  }

  // ─── Messaging Integrations (protected) ───────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('integrations')
  getIntegrations(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getIntegrations(user.tenantID);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Post('integrations')
  upsertIntegration(@CurrentUser() user: JwtPayload, @Body() dto: UpsertIntegrationDto) {
    return this.marketingService.upsertIntegration(user.tenantID, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Delete('integrations/:id')
  removeIntegration(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.marketingService.removeIntegration(id, user.tenantID);
  }

  // ─── Platform Links (protected) ───────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('platform-links')
  getPlatformLinks(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getPlatformLinks(user.tenantID);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Post('platform-links')
  upsertPlatformLink(@CurrentUser() user: JwtPayload, @Body() dto: UpsertPlatformLinkDto) {
    return this.marketingService.upsertPlatformLink(user.tenantID, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Delete('platform-links/:id')
  removePlatformLink(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.marketingService.removePlatformLink(id, user.tenantID);
  }

  // ─── Review Settings (protected) ──────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getSettings(user.tenantID);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateReviewSettingsDto) {
    return this.marketingService.updateSettings(user.tenantID, dto);
  }

  // ─── Reminder Settings (protected) ───────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('reminders')
  getReminderSettings(@CurrentUser() user: JwtPayload) {
    return this.reminderService.getSettings(user.tenantID);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Post('reminders')
  updateReminderSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateReminderSettingsDto) {
    return this.reminderService.updateSettings(user.tenantID, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Post('reminders/send')
  sendReminders(@CurrentUser() user: JwtPayload) {
    return this.reminderService.sendForTenant(user.tenantID);
  }

  // ─── Public Review Endpoints (no auth) ────────────────────────────
  // No JWT guard here on purpose — the customer follows a one-shot
  // tokenised link from SMS/WhatsApp. Tokens carry their own server-side
  // expiry + used_at marker (see marketing.service). The brute-force
  // surface is still covered by the global RateLimitGuard write bucket
  // (~150 req/min per IP); we additionally rely on class-validator via
  // SubmitReviewDto + ValidationPipe to bound input size.
  @Get('review/:token')
  getReviewByToken(@Param('token') token: string) {
    return this.marketingService.getReviewByToken(token);
  }

  @Post('review/:token')
  submitReview(@Param('token') token: string, @Body() dto: SubmitReviewDto) {
    return this.marketingService.submitReview(token, dto);
  }
}
