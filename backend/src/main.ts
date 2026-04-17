import './common/sentry';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ETagInterceptor } from './common/interceptors/etag.interceptor';
import { RateLimitGuard } from './common/guards/rate-limit.guard';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Trust the reverse proxy (nginx) so request.ip reflects the real client IP.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');

  // ── Security headers via Helmet ────────────────────────────────────────────
  app.use(
    helmet({
      // HSTS: 1 year, include subdomains, allow preload list submission
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      // Prevent clickjacking — DENY for API, SAMEORIGIN would be for framed UI
      frameguard: { action: 'deny' },
      // CSP: report-only initially so we can monitor without breaking the UI.
      // Once stable, flip reportOnly to false.
      contentSecurityPolicy: false, // handled by nginx for the frontend; API doesn't serve HTML
      // Hide X-Powered-By: Express
      hidePoweredBy: true,
      // Prevent MIME-type sniffing
      noSniff: true,
      // XSS filter (legacy browsers)
      xssFilter: true,
      // Don't reveal referrer on cross-origin
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Permissions policy — disable sensitive browser APIs
      permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    }),
  );

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ETagInterceptor());
  app.useGlobalGuards(new RateLimitGuard());
  app.enableCors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
      : ['https://autexa.pw', 'https://www.autexa.pw'],
    credentials: true,
  });

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  logger.log(`Server running on port ${port}`);
}
bootstrap();
