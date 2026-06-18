import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { UpdateBookingDto } from './dto/update-booking.dto';
import { ConvertBookingDto } from './dto/convert-booking.dto';
import { UpdateBookingSettingsDto } from './dto/update-booking-settings.dto';

/**
 * Internal «Записи» (appointments) API — staff-side only. Every route requires
 * `bookings_access` and is tenant-scoped from the JWT. Per-row visibility and
 * ownership (master = own only; admin/owner = any) are enforced in the service.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@RequirePermission('bookings_access')
@Controller('bookings')
export class BookingsController {
  constructor(private bookings: BookingsService) {}

  // ─── Settings — declared BEFORE :id routes so 'settings' isn't captured as an id. ─
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.bookings.getSettings(user.tenantID);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateBookingSettingsDto) {
    return this.bookings.updateSettings(user.tenantID, dto);
  }

  // ─── List ──────────────────────────────────────────────────────────
  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() query: { scope?: string; from?: string; to?: string }) {
    return this.bookings.list(user, query);
  }

  // ─── Create ────────────────────────────────────────────────────────
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBookingDto) {
    return this.bookings.create(user, dto);
  }

  // ─── Update ────────────────────────────────────────────────────────
  @Patch(':id')
  update(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: UpdateBookingDto) {
    return this.bookings.update(user, id, dto);
  }

  // ─── Cancel ────────────────────────────────────────────────────────
  @Post(':id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.bookings.cancel(user, id);
  }

  // ─── Convert (link a saved check) ──────────────────────────────────
  @Post(':id/convert')
  convert(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ConvertBookingDto) {
    return this.bookings.convert(user, id, dto.checkId);
  }
}
