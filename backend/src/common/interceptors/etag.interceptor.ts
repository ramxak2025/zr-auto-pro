import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, EMPTY } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Response, Request } from 'express';
import * as crypto from 'crypto';

/**
 * ETag Interceptor
 *
 * Generates an ETag header for GET responses by hashing the JSON body.
 * If the client sends `If-None-Match` matching the ETag, returns 304 Not Modified.
 *
 * Uses switchMap + EMPTY for 304 responses to prevent NestJS from trying
 * to serialize an undefined body (which caused intermittent white-screen errors
 * when the framework attempted to JSON.stringify(undefined)).
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
      switchMap((body) => {
        // Skip if response is already sent (streaming, file downloads)
        if (response.headersSent) return [body];

        // Skip non-JSON responses
        if (body === undefined || body === null) return [body];

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
            // Return EMPTY observable — NestJS won't try to send another response
            return EMPTY;
          }

          return [body];
        } catch {
          return [body];
        }
      }),
    );
  }
}
