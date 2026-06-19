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
        message = (res as any).message || message;
        if (Array.isArray(message)) message = message[0];
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
