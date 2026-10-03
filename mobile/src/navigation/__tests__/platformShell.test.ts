import { sessionShell } from '../platformShell';

describe('platform cabinet navigation', () => {
  it.each(['manager', 'superadmin'] as const)('%s opens its cabinet after login or cold restore', (role) => {
    expect(sessionShell(role, false)).toEqual({ platformMode: role, showImpersonation: false });
  });

  it.each(['manager', 'superadmin'] as const)('a restored impersonation flag cannot route %s as a master', (role) => {
    expect(sessionShell(role, true)).toEqual({ platformMode: role, showImpersonation: false });
  });

  it('actual impersonation uses the server-provided director role and keeps its exit banner', () => {
    expect(sessionShell('director', true)).toEqual({ platformMode: null, showImpersonation: true });
    expect(sessionShell('manager', false)).toEqual({ platformMode: 'manager', showImpersonation: false });
  });

  it.each(['director', 'admin', 'master', undefined, 'unknown'])(
    'does not promote %s into a platform operator',
    (role) => {
      expect(sessionShell(role, false)).toEqual({ platformMode: null, showImpersonation: false });
    },
  );
});
