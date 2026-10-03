import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { OneCService } from './one-c.service';
import { OneCKeyGuard } from './one-c.guard';
import { AckDto, ConfigureConnectionDto, CreateConnectionDto, ImportEventDto } from './one-c.dto';
import { Connection } from './one-c.types';

@Controller('one-c')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('director', 'superadmin')
export class OneCController {
  constructor(private service: OneCService) {}
  @Get('connection') settings(@CurrentUser() user: JwtPayload) {
    return this.service.settings(user);
  }
  @Post('connection') create(@CurrentUser() user: JwtPayload, @Body() dto: CreateConnectionDto) {
    return this.service.create(user, dto.pointId);
  }
  @Patch('connection') configure(@CurrentUser() user: JwtPayload, @Body() dto: ConfigureConnectionDto) {
    return this.service.configure(user, dto);
  }
  @Post('connection/rotate-key') rotate(@CurrentUser() user: JwtPayload) {
    return this.service.rotateKey(user);
  }
  @Get('journal') journal(
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.journal(user, limit, offset);
  }
}

@Controller('one-c/bridge')
@UseGuards(OneCKeyGuard)
export class OneCBridgeController {
  constructor(private service: OneCService) {}
  @Get('export') export(
    @Req() req: { oneCConnection: Connection },
    @Query('entityType') type: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.export(req.oneCConnection, type, cursor, limit);
  }
  @Post('import') import(@Req() req: { oneCConnection: Connection }, @Body() dto: ImportEventDto) {
    return this.service.import(req.oneCConnection, dto);
  }
  @Post('ack') ack(@Req() req: { oneCConnection: Connection }, @Body() dto: AckDto) {
    return this.service.ack(req.oneCConnection, dto);
  }
}
