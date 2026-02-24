import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response, Request } from 'express';
import * as crypto from 'crypto';

/**
 * ETag Interceptor
 *
 * Generates an ETag header for GET responses by hashing the JSON body.
 * If the client sends `If-None-Match` matching the ETag, returns 304 Not Modified
 * with NO body (per HTTP spec, 304 MUST NOT contain a body).
 */
@Injectable()
export class ETagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpCtx = context.switchToHttp();
    const request = httpCtx.getRequest<Request>();
    const response = httpCtx.getResponse<Response>();

    // Only apply to GET requests
    if (request.method !== 'GET') {
      return next.handle();
    }

    return next.handle().pipe(
      map((body) => {
        // Skip if response is already sent (streaming, file downloads)
        if (response.headersSent) return body;

        // Skip non-JSON responses
        if (body === undefined || body === null) return body;

        try {
          // Generate ETag from response body hash
          const json = JSON.stringify(body);
          const hash = crypto.createHash('md5').update(json).digest('hex');
          const etag = `"${hash}"`;

          response.setHeader('ETag', etag);
          response.setHeader('Cache-Control', 'private, no-cache');

          // Check If-None-Match — return 304 with empty body
          const ifNoneMatch = request.headers['if-none-match'];
          if (ifNoneMatch === etag) {
            response.status(304).end();
            return undefined;
          }

          return body;
        } catch {
          return body;
        }
      }),
    );
  }
}
