/** Route failures are not an authentication verdict, regardless of HTTP status. */
interface ResponseLike {
  status?: number;
  data?: unknown;
  headers?: unknown;
}

export const API_ROUTE_FAILURE_CODE = 'AUTEXA_API_ROUTE_FAILURE';

export function isHtmlApiResponse(response: ResponseLike | undefined): boolean {
  if (!response) return false;
  const headers = response.headers as { get?: (key: string) => unknown; [key: string]: unknown } | undefined;
  const contentType =
    (typeof headers?.get === 'function' ? headers.get('content-type') : undefined) ??
    (headers && Object.entries(headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1]);
  if (typeof contentType === 'string' && /(?:text\/html|application\/xhtml\+xml)/i.test(contentType)) return true;
  return (
    typeof response.data === 'string' &&
    /^\s*(?:<!--[\s\S]*?-->\s*)*<(?:!doctype\s+html|html|head|body|title|h1)(?:\s|>)/i.test(response.data)
  );
}

/** /auth/me has no permission403 contract: only an API JSON401 ends a session. */
export function isApiSessionDenial(error: unknown): boolean {
  const response = (error as { response?: ResponseLike } | null)?.response;
  if (!response || response.status !== 401 || isHtmlApiResponse(response)) return false;
  const data = response.data;
  return !!data && typeof data === 'object' && !Array.isArray(data);
}

export function isSessionProfileUrl(url: string): boolean {
  try {
    return /^(?:\/api)?\/auth\/me\/?$/i.test(new URL(url, 'https://autexa.invalid').pathname);
  } catch {
    return false;
  }
}
