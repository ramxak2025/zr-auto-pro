import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response, Request } from 'express';

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
        response.status(status).json({ message: msg, ...extra });
        return;
      } else if (typeof res === 'string') {
        message = res;
      }
    } else {
      this.logger.error(
        `ERROR [${request.method} ${request.url}]: ${exception}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({ message });
  }
}
