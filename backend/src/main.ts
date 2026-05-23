import 'dotenv/config';
import './common/sentry';
import 'reflect-metadata';
import { json, urlencoded } from 'express';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
// `compression` ships as CommonJS without a default export — using a
// default import compiles to `compression_1.default()` which is undefined
// in production. require() avoids the interop wrapper entirely.
// eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
const compression = require('compression');
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ETagInterceptor } from './common/interceptors/etag.interceptor';
import { RateLimitGuard } from './common/guards/rate-limit.guard';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Disable default body parser so we can set higher limits below
    // (default is 100 KB which fails CSV imports of a few hundred products).
    bodyParser: false,
  });

  // Raise JSON body limit to 50 MB — bulk imports, CSV uploads, etc.
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // gzip / deflate JSON responses — every client sends Accept-Encoding: gzip
  // by default. Mostly noticeable on list endpoints (products, checks,
  // schedule) where payloads run into tens of KB. Header response (304,
  // small responses < 1KB) are skipped automatically by the middleware.
  app.use(compression());

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
