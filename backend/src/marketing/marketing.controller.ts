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
import { UpdateCarReadySettingsDto } from './dto/update-car-ready-settings.dto';
import { WinbackSendDto } from './dto/winback-send.dto';
import { SegmentBroadcastDto } from './dto/segment-broadcast.dto';
import { BroadcastPreviewDto } from './dto/broadcast-preview.dto';
import { ReminderService } from './reminder.service';
import { actorPointId } from '../common/point-scope';

@Controller('marketing')
export class MarketingController {
  constructor(
    private marketingService: MarketingService,
    private reminderService: ReminderService,
  ) {}

  // Два уровня доступа к разделу «Маркетинг» (запрос владельца, миграция 137):
  //   • ПРОСМОТР  — 'marketing_access': все GET-чтения (dashboard, reviews,
  //     alerts, integrations, platform-links, settings, car-ready, reminders,
  //     winback, auto-mailings). Мастер видит раздел, только если владелец дал
  //     marketing_access;
  //   • УПРАВЛЕНИЕ — 'marketing_manage': ВСЕ мутации (POST/PATCH/DELETE
  //     integrations, platform-links, settings, car-ready, reminders(+send),
  //     winback/send, broadcast/send, alerts/:id/read). Отправлять рассылки и
  //     менять интеграции можно только с marketing_manage.
  // manage ⇒ view (flattenRoleMatrix): роль с marketing_manage проходит и
  // read-гейты. Owner-class (director/superadmin) обходит через PermissionsGuard;
  // у системного «Администратора» оба сида true — поведение 1:1.
  // Публичные /review/:token (страница отзыва клиента) — без auth, не трогаем.

  // ─── Dashboard (marketing_access) ─────────────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('dashboard')
  getDashboard(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getDashboard(user.tenantID);
  }

  // ─── Reviews list (marketing_access) ──────────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('reviews')
  getReviews(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.marketingService.getReviews(user.tenantID, query);
  }

  // ─── Alerts (marketing_access) ────────────────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('alerts')
  getAlerts(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getAlerts(user.tenantID);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Patch('alerts/:id/read')
  markAlertRead(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.marketingService.markAlertRead(id, user.tenantID);
  }

  // ─── Messaging Integrations (marketing_access) ────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('integrations')
  getIntegrations(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getIntegrations(user.tenantID);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Post('integrations')
  upsertIntegration(@CurrentUser() user: JwtPayload, @Body() dto: UpsertIntegrationDto) {
    return this.marketingService.upsertIntegration(user.tenantID, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Delete('integrations/:id')
  removeIntegration(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.marketingService.removeIntegration(id, user.tenantID);
  }

  // ─── Platform Links (marketing_access) ────────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('platform-links')
  getPlatformLinks(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getPlatformLinks(user.tenantID);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Post('platform-links')
  upsertPlatformLink(@CurrentUser() user: JwtPayload, @Body() dto: UpsertPlatformLinkDto) {
    return this.marketingService.upsertPlatformLink(user.tenantID, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Delete('platform-links/:id')
  removePlatformLink(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.marketingService.removePlatformLink(id, user.tenantID);
  }

  // ─── Review Settings (marketing_access) ───────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getSettings(user.tenantID);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateReviewSettingsDto) {
    return this.marketingService.updateSettings(user.tenantID, dto);
  }

  // ─── Car-ready («машина готова») notification settings ───────────
  // Read — marketing_access, write — marketing_manage (owner-class bypasses via
  // permissions.guard).
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('car-ready')
  getCarReadySettings(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getCarReadySettings(user.tenantID);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Patch('car-ready')
  updateCarReadySettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateCarReadySettingsDto) {
    return this.marketingService.updateCarReadySettings(user.tenantID, dto);
  }

  // ─── Reminder Settings (marketing_access) ────────────────────────
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('reminders')
  getReminderSettings(@CurrentUser() user: JwtPayload) {
    return this.reminderService.getSettings(user.tenantID);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Post('reminders')
  updateReminderSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateReminderSettingsDto) {
    return this.reminderService.updateSettings(user.tenantID, dto);
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Post('reminders/send')
  sendReminders(@CurrentUser() user: JwtPayload) {
    // Ручной запуск — от лица актора: рассылка режется филиалом его сессии.
    return this.reminderService.sendForTenant(user.tenantID, actorPointId(user));
  }

  // ─── Win-back («давно не приезжал») ──────────────────────────────
  // Read — marketing_access (просмотр сегмента), send — marketing_manage
  // (отправка рассылки). Owner-class roles (superadmin / director) bypass the
  // permission check entirely (permissions.guard); a master needs an explicit
  // marketing_manage grant to send. Mirrors the reminders/send gate.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('winback')
  async getWinback(@CurrentUser() user: JwtPayload, @Query('days') days?: string) {
    const parsed = days ? parseInt(days, 10) : undefined;
    // Сегмент режется филиалом читающего (161) — тем же, что и отправка.
    return this.marketingService.getWinbackSegment(
      user.tenantID,
      parsed,
      await this.marketingService.pointForActor(user.tenantID, actorPointId(user)),
    );
  }

  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Post('winback/send')
  winbackSend(@CurrentUser() user: JwtPayload, @Body() dto: WinbackSendDto) {
    return this.marketingService.winbackSend(user.tenantID, dto.days, dto.message, actorPointId(user));
  }

  // ─── Manual segment broadcast («Рассылки») ───────────────────────
  // Owner-class / marketing_manage gated (same gate as winback/reminders send).
  // Every recipient passes the anti-spam gate; the call is idempotent so a
  // retried request can't double-charge a client.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Post('broadcast/send')
  sendSegmentBroadcast(@CurrentUser() user: JwtPayload, @Body() dto: SegmentBroadcastDto) {
    return this.marketingService.sendSegmentBroadcast(
      user.tenantID,
      {
        segment: dto.segment,
        message: dto.message,
        integrationId: dto.integrationId ?? null,
        providerType: dto.providerType ?? null,
        idempotencyKey: dto.idempotencyKey ?? null,
      },
      user.userID,
      actorPointId(user),
    );
  }

  // ─── Broadcast preview (dry-run, marketing_manage) ───────────────
  // Предпросмотр ДО отправки: резолвит сегмент + канал и возвращает
  // {recipientsCount, sample, channel} — НИЧЕГО не отправляет и не пишет в
  // журнал. Гейт как у broadcast/send: смотреть «кому уйдёт» может только
  // тот, кто вправе отправить.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_manage')
  @Post('broadcast/preview')
  previewSegmentBroadcast(@CurrentUser() user: JwtPayload, @Body() dto: BroadcastPreviewDto) {
    return this.marketingService.previewSegmentBroadcast(
      user.tenantID,
      {
        segment: dto.segment,
        integrationId: dto.integrationId ?? null,
        providerType: dto.providerType ?? null,
      },
      // Предпросмотр обязан совпадать с отправкой, в т.ч. по филиалу (161).
      actorPointId(user),
    );
  }

  // ─── Журнал отправок (marketing_access) ──────────────────────────
  // Курсорная лента sent_messages (мигр. 124): каждое сообщение, которое
  // реально ушло (или не ушло) клиентам — тип, канал, кому, когда, статус.
  // meta несёт лимиты анти-спам-гейта (потолок 3/24ч, окно дубля 1ч), чтобы
  // UI показывал гарантии из первоисточника, а не хардкодом.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('sent-messages')
  getSentMessages(@CurrentUser() user: JwtPayload, @Query() query: any) {
    return this.marketingService.getSentMessages(user.tenantID, query);
  }

  // ─── Auto-mailings overview (read-only, marketing_access) ────────
  // ЕДИНЫЙ реестр всех 6 авто-сценариев (review / car-ready / booking
  // confirm+reminder / installment & service reminders): enabled + описание
  // триггера + lastSentAt из журнала + deep-link на редактор настроек.
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('marketing_access')
  @Get('auto-mailings')
  getAutoMailings(@CurrentUser() user: JwtPayload) {
    return this.marketingService.getAutoMailings(user.tenantID);
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
