import { Body, Controller, Get, Param, Patch, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { PermissionsGuard, RequirePermission } from '../common/guards/permissions.guard';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { WalletService } from './wallet.service';
import { UpdateWalletSettingsDto } from './dto/update-wallet-settings.dto';

/**
 * Apple Wallet — карта лояльности (.pkpass) — tenant-scoped from the JWT.
 *
 * AUTHENTICATED controller: JwtAuthGuard is applied here at the class level, the
 * same opt-in pattern every other controller uses.
 *
 * Config (settings) rides the 'settings_manage' matrix cell (миграция 136) —
 * the matrix is authoritative; owner-class (director/superadmin) bypasses via
 * PermissionsGuard. The pass download is open to ANY authenticated tenant user
 * (a cashier may hand a client their card) but is tenant-scoped — it only ever
 * generates a pass for this tenant's client. The cert/key/password/WWDR are
 * WRITE-ONLY — getSettings returns only boolean "stored" flags, never the raw PEM.
 *
 * INERT until configured: GET /wallet/pass/:clientId returns 422 until the owner
 * uploads a real Pass Type ID cert + key + Apple WWDR cert AND flips `enabled` on.
 */
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Controller('wallet')
export class WalletController {
  constructor(private wallet: WalletService) {}

  // ─── Config ('settings_manage'). Literal routes BEFORE param routes. ──────
  @RequirePermission('settings_manage')
  @Get('settings')
  getSettings(@CurrentUser() user: JwtPayload) {
    return this.wallet.getSettings(user.tenantID);
  }

  @RequirePermission('settings_manage')
  @Patch('settings')
  updateSettings(@CurrentUser() user: JwtPayload, @Body() dto: UpdateWalletSettingsDto) {
    return this.wallet.updateSettings(user.tenantID, dto);
  }

  // ─── Signed .pkpass download (any tenant user; tenant-scoped) ─────────────
  //
  // Uses @Res() to stream binary bytes directly. Any 422/404 thrown by the service
  // happens BEFORE a byte is written, so the global HttpExceptionFilter handles it
  // as normal JSON; the global ETagInterceptor is a no-op here because headers are
  // already sent by the time it runs (it explicitly skips `headersSent` responses).
  @Get('pass/:clientId')
  async getPass(
    @CurrentUser() user: JwtPayload,
    @Param('clientId') clientId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, fileName } = await this.wallet.generatePass(user.tenantID, clientId);
    res.setHeader('Content-Type', 'application/vnd.apple.pkpass');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }
}
