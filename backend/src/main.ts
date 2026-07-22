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
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { PG_POOL } from './database.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ETagInterceptor } from './common/interceptors/etag.interceptor';
import { SubscriptionGuardInterceptor } from './common/interceptors/subscription-guard.interceptor';
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
  // SubscriptionGuardInterceptor — enforcement подписки тенанта (R10). Именно
  // interceptor, а не guard: JwtAuthGuard стоит пер-контроллерно, глобальный
  // guard исполнился бы ДО него (request.user пуст) — interceptors же идут
  // ПОСЛЕ всех guards. Приостановленный/истёкший тенант → 403
  // SUBSCRIPTION_BLOCKED (не 401 — клиент показывает paywall, не разлогинивает).
  app.useGlobalInterceptors(new ETagInterceptor(), new SubscriptionGuardInterceptor(app.get<Pool>(PG_POOL)));
  app.useGlobalGuards(new RateLimitGuard());
  app.enableCors({
    origin: process.env.CORS_ORIGIN
      ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
      : // Оба домена: autexa-cloud.ru — основной для RU-клиентов (операторы
        // фильтруют зону .pw), autexa.pw — резерв/легаси. Same-origin запросы
        // web-PWA под CORS не попадают (фронт и API за одним nginx) — список
        // страхует только явные cross-origin сценарии.
        ['https://autexa-cloud.ru', 'https://www.autexa-cloud.ru', 'https://autexa.pw', 'https://www.autexa.pw'],
    credentials: true,
  });

  // ── Graceful shutdown (убирает 504 в окне деплоя) ───────────────────────
  // На SIGTERM/SIGINT (Docker `stop` / --force-recreate при деплое) Nest теперь
  // корректно закрывает HTTP-сервер: перестаёт принимать новые соединения и
  // даёт запросам «в полёте» завершиться до выхода процесса. Без этого процесс
  // убивался прямо посреди запроса, и запрос «в полёте» (например, создание
  // чека) терялся, а nginx — всё ещё держа keepalive-соединение к умирающему
  // бэкенду — ждал весь proxy_read_timeout и возвращал пользователю 504.
  // В паре с `stop_grace_period` в docker-compose, чтобы Docker дождался слива.
  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen(port);
  logger.log(`Server running on port ${port}`);
}
bootstrap();
