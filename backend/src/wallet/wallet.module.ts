import { Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

/**
 * Apple Wallet — карта лояльности (.pkpass). PG_POOL is provided globally by
 * DatabaseModule (@Global) — no import needed. Single AUTHENTICATED controller.
 *
 * Owns `wallet_settings` (migration 089); READS clients / client_bonuses / tenants
 * read-only to fill the card (NEVER writes the loyalty ledger). The pass is built
 * and PKCS#7-signed server-side via passkit-generator.
 *
 * INERT until the owner uploads a real Apple Pass Type ID cert + key + Apple WWDR
 * cert AND enables it — GET /wallet/pass/:clientId returns 422 otherwise.
 */
@Module({
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
