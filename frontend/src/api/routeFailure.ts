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
  const body = response.data;
  if (typeof body !== 'string') return false;
  let cursor = 0;
  const whitespace = /\s/;
  // Each iteration consumes a disjoint prefix. Nested regexp repetition here
  // makes even a short run of comments exponentially expensive on a non-HTML body.
  for (;;) {
    while (cursor < body.length && whitespace.test(body[cursor])) cursor += 1;
    if (body.startsWith('<!--', cursor)) {
      const end = body.indexOf('-->', cursor + 4);
      if (end === -1) return false;
      cursor = end + 3;
      continue;
    }
    // XML declaration/prolog names are ASCII; fold only these three characters
    // without copying the remaining response for every prefix.
    const xml =
      body.startsWith('<?', cursor) &&
      (body.charCodeAt(cursor + 2) | 32) === 120 &&
      (body.charCodeAt(cursor + 3) | 32) === 109 &&
      (body.charCodeAt(cursor + 4) | 32) === 108;
    if (xml) {
      const end = body.indexOf('?>', cursor + 5);
      if (end === -1) return false;
      cursor = end + 2;
      continue;
    }
    break;
  }
  return /^<(?:!doctype\s+html|html|head|body|title|h1)(?:\s|>)/i.test(body.slice(cursor));
}

/** Nest auth denials are JSON401 objects with a string message, never arbitrary proxy bodies. */
export function isApiSessionDenial(error: unknown): boolean {
  const response = (error as { response?: ResponseLike } | null)?.response;
  if (!response || response.status !== 401 || isHtmlApiResponse(response)) return false;
  const data = response.data;
  return (
    !!data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    typeof (data as { message?: unknown }).message === 'string'
  );
}

export function isSessionProfileUrl(url: string): boolean {
  try {
    return /^(?:\/api)?\/auth\/me\/?$/i.test(new URL(url, 'https://autexa.invalid').pathname);
  } catch {
    return false;
  }
}
