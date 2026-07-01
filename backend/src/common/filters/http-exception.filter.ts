import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response, Request } from 'express';
// Import Sentry the same way sentry.ts does. Importing `../sentry` (rather than
// `@sentry/nestjs` directly) also guarantees Sentry.init() has already run and
// gives us the `isSentryEnabled` DSN flag for the capture guard below.
import * as Sentry from '@sentry/nestjs';
import { isSentryEnabled } from '../sentry';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // The response may already be committed — most often by the ETagInterceptor,
    // which ends a 304 itself and then completes with an empty observable;
    // NestJS turns that empty completion into an RxJS `EmptyError` that lands
    // here. Calling response.json() below would then throw
    // `ERR_HTTP_HEADERS_SENT`, and that throw is UNHANDLED inside the exception
    // filter — so it kills the whole Node process. Every client retry re-hits
    // the endpoint and re-crashes it → a restart storm and a wave of 502s on
    // unrelated requests (check creation, schedule saves). If the headers are
    // already out there is nothing left to send: stop here, never crash.
    if (response.headersSent) {
      return;
    }

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Ошибка сервера';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        const obj = res as Record<string, unknown>;
        let msg: unknown = obj.message ?? message;
        if (Array.isArray(msg)) msg = msg[0];
        // Preserve any EXTRA structured fields the thrower attached — e.g. the
        // ConflictException that carries { code, clientId, client } for the
        // duplicate-phone contract (shared `ClientPhoneConflict`). `message` is
        // still flattened to a string and Nest's internal `statusCode`/`error`
        // scaffolding is stripped, so every existing consumer keeps seeing an
        // identical `{ message }`: a plain `{ message }` throw yields no extras.
        const extra: Record<string, unknown> = { ...obj };
        delete extra.message;
        delete extra.statusCode;
        delete extra.error;
        // Observe 5xx even on the HttpException branch (e.g. an explicit
        // InternalServerErrorException) BEFORE writing the unchanged body.
        this.report5xx(status, request, exception, msg);
        response.status(status).json({ message: msg, ...extra });
        return;
      } else if (typeof res === 'string') {
        message = res;
      }
    }

    // Reaches here for a non-HttpException (unknown throw → 500) or an
    // HttpException with a plain string body. Observe any 5xx with method+url.
    this.report5xx(status, request, exception, message);

    response.status(status).json({ message });
  }

  /**
   * Structured 5xx observability. Runs ONLY after the `headersSent` guard and
   * ONLY for status >= 500, so 4xx (validation, auth, conflicts) stay quiet.
   * Logs the failing method+url+message+stack so the VDS logs reveal WHICH
   * endpoint is 500-ing (there is no backend Sentry project yet), and — when a
   * DSN is configured — forwards the exception. Everything is wrapped so a
   * logging/Sentry failure can never mask the original error or crash the
   * process from inside the exception filter.
   */
  private report5xx(status: number, request: Request, exception: unknown, message: unknown): void {
    if (status < 500) return;
    try {
      const method = request?.method ?? '?';
      const url = request?.originalUrl || request?.url || '?';
      const stack = exception instanceof Error ? exception.stack : undefined;
      const detail = exception instanceof Error ? exception.message : String(message ?? '');
      this.logger.error(`5xx ${status} [${method} ${url}]: ${detail}`, stack);
      if (isSentryEnabled) {
        Sentry.captureException(exception);
      }
    } catch {
      /* observability must never throw inside the exception filter */
    }
  }
}
