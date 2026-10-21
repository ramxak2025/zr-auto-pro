import { isPublicSessionLandingPath } from '../api/publicAuthPath';

/** Public rendering is broader than the public-flow exception to hard logout. */
export function canRenderWithoutSessionProfile(pathname: string): boolean {
  if (isPublicSessionLandingPath(pathname)) return true;
  const parts = pathname.toLowerCase().split('/').filter(Boolean);
  if (parts.length === 0) return true;
  if (parts.length === 1 && ['privacy', 'terms', 'tarify', 'voprosy', 'login', 'register'].includes(parts[0]))
    return true;
  return parts.length === 2 && (parts[0] === 'f' || parts[0] === 'review');
}
