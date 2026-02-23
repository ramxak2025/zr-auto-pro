import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpStatus,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Response, Request } from 'express';
import * as crypto from 'crypto';

/**
 * ETag Interceptor
 *
 * Generates an ETag header for GET responses by hashing the JSON body.
 * If the client sends `If-None-Match` matching the ETag, returns 304 Not Modified
 * with an empty body — saving bandwidth and reducing latency.
 *
 * This is especially effective for:
 * - List pages that rarely change (services, users, categories)
 * - Dashboard data within the same minute
 * - Any cached React Query request that refetches in background
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
          // Allow caching but require revalidation
          response.setHeader('Cache-Control', 'private, no-cache');

          // Check If-None-Match
          const ifNoneMatch = request.headers['if-none-match'];
          if (ifNoneMatch === etag) {
            response.status(HttpStatus.NOT_MODIFIED);
            return undefined;
          }

          return body;
        } catch {
          // If hashing fails, just return the body as-is
          return body;
        }
      }),
    );
  }
}
