/** Resolve stored upload paths against the active API origin. */
export function resolveImageUrl(path: string | null | undefined, apiBaseUrl: string): string | undefined {
  if (!path) return undefined;
  if (/^(?:https?:|data:)/i.test(path)) return path;
  const origin = apiBaseUrl.replace(/\/api\/?$/, '');
  return `${origin}${path.startsWith('/') ? '' : '/'}${path}`;
}
