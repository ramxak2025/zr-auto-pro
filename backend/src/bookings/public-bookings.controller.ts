import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { PublicBookingsService } from './public-bookings.service';
import {
  ApprovePublicBookingDto,
  BookingOperationDto,
  PublicBookingSettingsDto,
  PublicBookingSubmitDto,
} from './dto/public-booking.dto';

/** Public traffic never attaches a staff JWT or consumes its tenant context. */
@Controller('public/bookings')
export class PublicBookingsController {
  constructor(private readonly service: PublicBookingsService) {}
  @Get(':slug')
  @Header('Cache-Control', 'no-store')
  landing(@Param('slug') slug: string) {
    return this.service.landing(slug);
  }
  @Get(':slug/slots')
  @Header('Cache-Control', 'no-store')
  slots(
    @Param('slug') slug: string,
    @Query() query: { from?: string; to?: string; serviceIds?: string; after?: string },
  ) {
    return this.service.slots(slug, query);
  }
  @Post(':slug/requests')
  @Header('Cache-Control', 'no-store')
  submit(@Param('slug') slug: string, @Body() dto: PublicBookingSubmitDto) {
    return this.service.submit(slug, dto);
  }
  @Get(':slug/requests/:requestId')
  @Header('Cache-Control', 'no-store')
  status(
    @Param('slug') slug: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Headers('x-booking-recovery') recovery: unknown,
  ) {
    return this.service.status(slug, requestId, recovery);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('bookings')
export class BookingPublicationController {
  constructor(private readonly service: PublicBookingsService) {}
  @Get('public-settings')
  @RequirePermission('company_manage')
  settings(@CurrentUser() actor: JwtPayload) {
    return this.service.getSettings(actor);
  }
  @Put('public-settings')
  @RequirePermission('company_manage')
  put(@CurrentUser() actor: JwtPayload, @Body() dto: PublicBookingSettingsDto) {
    return this.service.putSettings(actor, dto);
  }
  @Get('public-resources')
  @RequirePermission('company_manage')
  resources(@CurrentUser() actor: JwtPayload) {
    return this.service.resources(actor);
  }
  @Post('public-settings/publish')
  @RequirePermission('company_manage')
  publish(@CurrentUser() actor: JwtPayload, @Body() dto: BookingOperationDto) {
    return this.service.publish(actor, dto, true);
  }
  @Post('public-settings/unpublish')
  @RequirePermission('company_manage')
  unpublish(@CurrentUser() actor: JwtPayload, @Body() dto: BookingOperationDto) {
    return this.service.publish(actor, dto, false);
  }
  @Get('requests')
  @RequirePermission('bookings_access')
  requests(@CurrentUser() actor: JwtPayload, @Query() query: { status?: string }) {
    return this.service.requests(actor, query);
  }
  @Post('requests/:id/approve')
  @RequirePermission('bookings_access')
  approve(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovePublicBookingDto,
  ) {
    return this.service.decide(actor, id, dto, true);
  }
  @Post('requests/:id/reject')
  @RequirePermission('bookings_access')
  reject(@CurrentUser() actor: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BookingOperationDto) {
    return this.service.decide(actor, id, dto, false);
  }
}
