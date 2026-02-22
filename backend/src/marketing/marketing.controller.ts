import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { MarketingService } from './marketing.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';

@Controller('marketing')
export class MarketingController {
  constructor(private marketingService: MarketingService) {}

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

  @UseGuards(JwtAuthGuard)
  @Post('integrations')
  upsertIntegration(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.marketingService.upsertIntegration(user.tenantID, dto);
  }

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Post('platform-links')
  upsertPlatformLink(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.marketingService.upsertPlatformLink(user.tenantID, dto);
  }

  @UseGuards(JwtAuthGuard)
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

  @UseGuards(JwtAuthGuard)
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: any) {
    return this.marketingService.updateSettings(user.tenantID, dto);
  }

  // ─── Public Review Endpoints (no auth) ────────────────────────────
  @Get('review/:token')
  getReviewByToken(@Param('token') token: string) {
    return this.marketingService.getReviewByToken(token);
  }

  @Post('review/:token')
  submitReview(@Param('token') token: string, @Body() dto: { rating: number; comment?: string; redirectedTo?: string }) {
    return this.marketingService.submitReview(token, dto);
  }
}
