import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AccountService } from './account.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { AllowNoTenant } from '../common/decorators/allow-no-tenant.decorator';
import { CurrentUser, JwtPayload } from '../common/decorators/current-user.decorator';
import { DeleteAccountDto } from './dto/delete-account.dto';

/**
 * Self-service account management for the authenticated user.
 *
 * `POST /account/delete` is the in-app account-deletion entry point required by
 * Apple Guideline 5.1.1(v) and Google Play. JWT-guarded (the global guard is
 * RateLimit only; JwtAuthGuard is applied here, mirroring AuthController). The
 * destructive semantics live in AccountService.
 */
// Self-service account deletion keys off userID (anonymises the users row,
// drops push tokens) and never inserts under the caller's tenant_id, so it is
// a legitimate tenant-less write — exempt from the write block.
@AllowNoTenant()
@UseGuards(JwtAuthGuard)
@Controller('account')
export class AccountController {
  constructor(private account: AccountService) {}

  @Post('delete')
  deleteAccount(@CurrentUser() user: JwtPayload, @Body() dto: DeleteAccountDto) {
    return this.account.deleteAccount(user, dto);
  }
}
