/**
 * app.config.js — APNs environment resolution.
 *
 * This is the single line that broke every push notification in production:
 * the expo-notifications plugin defaults `mode` to 'development', so release
 * builds shipped `aps-environment: development`, registered against the SANDBOX
 * APNs gateway, and silently received nothing (Expo tickets still said "ok").
 *
 * The rules below are load-bearing — especially "unknown environment ⇒
 * production", which makes a broken env var fail LOUDLY at dev-build signing
 * instead of silently killing notifications for real users again.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const appConfig = require('../../app.config.js') as (arg: { config: Record<string, unknown> }) => {
  plugins: unknown[];
  extra: Record<string, unknown>;
};

type PluginEntry = string | [string, Record<string, unknown>];

const BASE_CONFIG = {
  version: '3.2.1',
  plugins: ['expo-updates', ['expo-notifications', { icon: './assets/icon.png', color: '#2563eb' }]] as PluginEntry[],
  extra: { apiUrl: 'https://autexa.pw/api' },
};

function resolve(env: Record<string, string | undefined>) {
  const saved = { APS_ENV: process.env.APS_ENV, EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE };
  try {
    for (const key of ['APS_ENV', 'EAS_BUILD_PROFILE'] as const) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    const result = appConfig({ config: JSON.parse(JSON.stringify(BASE_CONFIG)) });
    const entry = result.plugins.find(
      (p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === 'expo-notifications',
    );
    return { props: entry?.[1] ?? {}, extra: result.extra, plugins: result.plugins };
  } finally {
    for (const key of ['APS_ENV', 'EAS_BUILD_PROFILE'] as const) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

describe('app.config.js — aps-environment', () => {
  it('defaults to production when no build profile is set', () => {
    const { props, extra } = resolve({ APS_ENV: undefined, EAS_BUILD_PROFILE: undefined });
    expect(props.mode).toBe('production');
    expect(extra.apsEnvironment).toBe('production');
  });

  it('uses production for the preview and production EAS profiles', () => {
    expect(resolve({ EAS_BUILD_PROFILE: 'production' }).props.mode).toBe('production');
    expect(resolve({ EAS_BUILD_PROFILE: 'preview' }).props.mode).toBe('production');
  });

  it('uses development ONLY for the development EAS profile', () => {
    const { props, extra } = resolve({ EAS_BUILD_PROFILE: 'development' });
    expect(props.mode).toBe('development');
    expect(extra.apsEnvironment).toBe('development');
  });

  it('lets APS_ENV override the build profile in both directions', () => {
    expect(resolve({ APS_ENV: 'development', EAS_BUILD_PROFILE: 'production' }).props.mode).toBe('development');
    expect(resolve({ APS_ENV: 'production', EAS_BUILD_PROFILE: 'development' }).props.mode).toBe('production');
  });

  it('falls back to production on a garbage APS_ENV rather than guessing', () => {
    expect(resolve({ APS_ENV: 'staging', EAS_BUILD_PROFILE: undefined }).props.mode).toBe('production');
  });

  it('enables background remote notifications so silent data pushes can wake the app', () => {
    // Info.plist had NO UIBackgroundModes at all — the backend's
    // sendDataToTenant cache-invalidation pushes could never be delivered.
    expect(resolve({}).props.enableBackgroundRemoteNotifications).toBe(true);
  });

  it('keeps the icon/color authored in app.json and the other plugins intact', () => {
    const { props, plugins } = resolve({});
    expect(props.icon).toBe('./assets/icon.png');
    expect(props.color).toBe('#2563eb');
    expect(plugins).toContain('expo-updates');
    expect(plugins).toHaveLength(2);
  });

  it('preserves the rest of extra (apiUrl etc.)', () => {
    expect(resolve({}).extra.apiUrl).toBe('https://autexa.pw/api');
  });
});
