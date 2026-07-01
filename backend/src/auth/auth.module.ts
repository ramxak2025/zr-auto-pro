import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

/**
 * JWT secret loader — fail fast on boot.
 *
 * The previous fallback (`process.env.JWT_SECRET || 'change-me-in-production'`)
 * was dangerous in two ways:
 *   1. If the env var was missing on a fresh deploy, the API would still
 *      accept logins and sign tokens with a public, well-known string —
 *      anyone could mint admin tokens.
 *   2. The fail-safe in JwtStrategy only fires on the first request; if the
 *      app boots and the strategy is never constructed, the bad secret can
 *      be used to issue tokens before anyone notices.
 *
 * We now refuse to start at all if JWT_SECRET is missing or matches the
 * old placeholder. The same check existed in JwtStrategy already; this
 * just moves it earlier so it covers the SIGNING side too.
 */
function loadJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'change-me-in-production') {
    throw new Error('FATAL: JWT_SECRET environment variable must be set to a strong random value');
  }
  if (secret.length < 32) {
    throw new Error('FATAL: JWT_SECRET must be at least 32 characters');
  }
  return secret;
}

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: loadJwtSecret(),
      // 30-day access tokens. Autexa is a staff-facing business app used daily
      // from a personal phone — a 7-day TTL was silently logging masters out
      // mid-work (~20 users hitting `auth_expired_forced_logout` in Sentry,
      // ongoing). A longer window is safe here because per-token revocation is
      // retained: POST /auth/logout black-lists the jti in `revoked_tokens`
      // (checked on every request), and deactivating/dismissing a user rejects
      // their tokens immediately regardless of expiry.
      signOptions: { expiresIn: '30d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [JwtModule],
})
export class AuthModule {}
