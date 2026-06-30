import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * «Мой профиль» — self profile edit / password change + owner approval queue.
 *
 * No imports needed: PG_POOL is provided globally (DatabaseModule) and
 * PushService globally (@Global PushModule), so both inject without wiring.
 */
@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
