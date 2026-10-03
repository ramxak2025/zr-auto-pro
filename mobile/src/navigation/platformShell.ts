/** The server's current role owns the shell. An impersonated owner is director. */
export function platformShellMode(role: string | null | undefined): 'manager' | 'superadmin' | null {
  return role === 'manager' || role === 'superadmin' ? role : null;
}

export function sessionShell(role: string | null | undefined, isImpersonating: boolean) {
  const platformMode = platformShellMode(role);
  return { platformMode, showImpersonation: platformMode === null && isImpersonating };
}
