import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { NfcScanDto, NfcTagNameDto, NfcTokenDto } from './dto/nfc.dto';
import { ShiftsNfcService } from './shifts-nfc.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('shifts/nfc')
export class ShiftsNfcController {
  constructor(private readonly service: ShiftsNfcService) {}
  @Header('Cache-Control', 'no-store')
  @Get('status')
  status(@CurrentUser() actor: JwtPayload) {
    return this.service.status(actor);
  }
  @Header('Cache-Control', 'no-store')
  @Get('requests/:requestId')
  result(@CurrentUser() actor: JwtPayload, @Param('requestId', ParseUUIDPipe) requestId: string) {
    return this.service.result(actor, requestId);
  }
  @Header('Cache-Control', 'no-store')
  @Post('scan')
  scan(@CurrentUser() actor: JwtPayload, @Body() dto: NfcScanDto) {
    return this.service.scan(actor, dto);
  }
  @RequirePermission('company_manage')
  @Header('Cache-Control', 'no-store')
  @Get('tags')
  tags(@CurrentUser() actor: JwtPayload) {
    return this.service.listTags(actor);
  }
  @RequirePermission('company_manage')
  @Header('Cache-Control', 'no-store')
  @Post('tags')
  create(@CurrentUser() actor: JwtPayload, @Body() dto: NfcTagNameDto) {
    return this.service.createTag(actor, dto);
  }
  @RequirePermission('company_manage')
  @Header('Cache-Control', 'no-store')
  @Post('tags/:id/activate')
  activate(@CurrentUser() actor: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NfcTokenDto) {
    return this.service.activateTag(actor, id, dto);
  }
  @RequirePermission('company_manage')
  @Header('Cache-Control', 'no-store')
  @Patch('tags/:id')
  rename(@CurrentUser() actor: JwtPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NfcTagNameDto) {
    return this.service.renameTag(actor, id, dto);
  }
  @RequirePermission('company_manage')
  @Header('Cache-Control', 'no-store')
  @Post('tags/:id/revoke')
  revoke(@CurrentUser() actor: JwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.revokeTag(actor, id);
  }
}
