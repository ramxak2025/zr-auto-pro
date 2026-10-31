'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const resolveAppConfig = require('../app.config.js');
const base = require('../app.json').expo;
const eas = require('../eas.json');

const ENV_KEYS = [
  'APS_ENV',
  'EAS_BUILD_PROFILE',
  'EAS_BUILD_PLATFORM',
  'AUTEXA_OWNER_HOME_INTERNAL',
  'AUTEXA_OWNER_HOME_RELEASE',
  'EXPO_PUBLIC_OWNER_HOME_PILOT',
];

function resolve(env = {}) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  try {
    for (const key of ENV_KEYS) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
    return resolveAppConfig({ config: structuredClone(base) });
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('ordinary configurations without an explicit iOS release selector remain unchanged', () => {
  const defaultConfig = resolve();
  // These fields are native/update delivery boundaries, not only UI defaults.
  assert.equal(defaultConfig.version, base.version);
  assert.deepEqual(defaultConfig.ios, base.ios);
  assert.deepEqual(defaultConfig.android, base.android);
  assert.deepEqual(defaultConfig.runtimeVersion, base.runtimeVersion);
  assert.deepEqual(defaultConfig.updates, base.updates);
  assert.equal(Object.hasOwn(defaultConfig.extra, 'ownerHomePilot'), false);
  assert.deepEqual(defaultConfig.extra, { ...base.extra, apsEnvironment: 'production' });
  for (const profile of ['production', 'preview', 'owner-home-internal-typo']) {
    for (const platform of [undefined, 'ios', 'android']) {
      assert.deepEqual(resolve({ EAS_BUILD_PROFILE: profile, EAS_BUILD_PLATFORM: platform }), defaultConfig);
    }
  }
});

test('the exact internal iOS profile retains its private pilot configuration', () => {
  const profile = eas.build['owner-home-internal'];
  const internal = resolve(profile.ios.env);
  const normal = resolve();
  assert.equal(internal.version, '3.19.0');
  assert.equal(internal.ios.runtimeVersion, '3.19.0-owner-home-internal');
  assert.equal(internal.extra.ownerHomePilot, true);
  assert.equal(internal.extra.apsEnvironment, 'production');
  assert.deepEqual(
    resolve({ ...profile.ios.env, EAS_BUILD_PROFILE: 'owner-home-internal', EAS_BUILD_PLATFORM: 'ios' }),
    internal,
  );
  assert.deepEqual(internal.android, normal.android);
  assert.deepEqual(internal.runtimeVersion, normal.runtimeVersion);
  assert.deepEqual(internal.updates, normal.updates);
  assert.deepEqual(internal.extra.apiUrl, normal.extra.apiUrl);
  assert.deepEqual(internal.extra.apiFallbackUrls, normal.extra.apiFallbackUrls);

  // Removing just the three intentional overrides must recover the whole
  // ordinary config, including plugins, capabilities, API ring and extensions.
  const restored = structuredClone(internal);
  restored.version = normal.version;
  restored.ios = normal.ios;
  delete restored.extra.ownerHomePilot;
  assert.deepEqual(restored, normal);
});

test('only the exact private profile selector can opt in, and conflicting platform/profile stays ordinary', () => {
  const normal = resolve();
  for (const env of [
    { EAS_BUILD_PROFILE: 'owner-home-internal' },
    { EAS_BUILD_PLATFORM: 'ios' },
    { AUTEXA_OWNER_HOME_INTERNAL: 'true' },
    { AUTEXA_OWNER_HOME_INTERNAL: 'ios-v1', EAS_BUILD_PLATFORM: 'android' },
    { AUTEXA_OWNER_HOME_INTERNAL: 'ios-v1', EAS_BUILD_PROFILE: 'production' },
    { AUTEXA_OWNER_HOME_INTERNAL: 'ios-v1', EAS_BUILD_PROFILE: 'preview' },
    { EAS_BUILD_PROFILE: 'owner-home-internal', EAS_BUILD_PLATFORM: 'android' },
    { EAS_BUILD_PROFILE: 'production', EAS_BUILD_PLATFORM: 'ios', EXPO_PUBLIC_OWNER_HOME_PILOT: 'true' },
    { EXPO_PUBLIC_OWNER_HOME_PILOT: 'true' },
  ]) {
    assert.deepEqual(resolve(env), normal);
  }
});

test('public production iOS embeds the owner dashboard on its own ordinary runtime', () => {
  const profile = eas.build.production;
  assert.deepEqual(profile.ios.env, { AUTEXA_OWNER_HOME_RELEASE: 'ios-v1' });
  const publicConfig = resolve(profile.ios.env);
  const normal = resolve();
  assert.equal(publicConfig.version, '3.19.0');
  assert.equal(publicConfig.ios.runtimeVersion, '3.19.0');
  assert.equal(publicConfig.extra.ownerHomePilot, true);
  assert.equal(publicConfig.extra.apsEnvironment, 'production');
  assert.deepEqual(
    resolve({ ...profile.ios.env, EAS_BUILD_PROFILE: 'production', EAS_BUILD_PLATFORM: 'ios' }),
    publicConfig,
  );
  const restored = structuredClone(publicConfig);
  restored.version = normal.version;
  restored.ios = normal.ios;
  delete restored.extra.ownerHomePilot;
  assert.deepEqual(restored, normal);
  assert.notEqual(
    publicConfig.ios.runtimeVersion,
    resolve(eas.build['owner-home-internal'].ios.env).ios.runtimeVersion,
  );
});

test('public selector cannot enable Android, preview, development or a private-profile build', () => {
  const normal = resolve();
  for (const env of [
    { AUTEXA_OWNER_HOME_RELEASE: 'true' },
    { AUTEXA_OWNER_HOME_RELEASE: 'ios-v1', EAS_BUILD_PLATFORM: 'android' },
    { AUTEXA_OWNER_HOME_RELEASE: 'ios-v1', EAS_BUILD_PROFILE: 'preview' },
    { AUTEXA_OWNER_HOME_RELEASE: 'ios-v1', EAS_BUILD_PROFILE: 'owner-home-internal' },
    { AUTEXA_OWNER_HOME_RELEASE: 'ios-v1', EAS_BUILD_PROFILE: 'production-typo' },
  ])
    assert.deepEqual(resolve(env), normal);
  assert.deepEqual(
    resolve({ AUTEXA_OWNER_HOME_RELEASE: 'ios-v1', EAS_BUILD_PROFILE: 'development' }),
    resolve({ EAS_BUILD_PROFILE: 'development' }),
  );
  assert.equal(eas.build.production.env?.AUTEXA_OWNER_HOME_RELEASE, undefined);
  assert.equal(eas.build.production.android.env?.AUTEXA_OWNER_HOME_RELEASE, undefined);
});

test('ambiguous public/private selectors fail closed before producing any native configuration', () => {
  for (const profile of [undefined, 'production', 'owner-home-internal']) {
    assert.throws(
      () =>
        resolve({
          AUTEXA_OWNER_HOME_INTERNAL: 'ios-v1',
          AUTEXA_OWNER_HOME_RELEASE: 'ios-v1',
          EAS_BUILD_PROFILE: profile,
        }),
      /OWNER_HOME_RELEASE_SELECTOR_CONFLICT/,
    );
  }
});

test('the dedicated release uses store signing and only the existing internal tester group', () => {
  assert.deepEqual(eas.build['owner-home-internal'], {
    distribution: 'store',
    channel: 'owner-home-internal',
    autoIncrement: true,
    ios: {
      buildConfiguration: 'Release',
      env: { AUTEXA_OWNER_HOME_INTERNAL: 'ios-v1' },
    },
  });
  assert.deepEqual(eas.submit['owner-home-internal'], {
    ios: { ascAppId: '6776855208', groups: ['Team (Expo)'] },
  });
  assert.equal(eas.cli.appVersionSource, 'remote');
  assert.equal(eas.build.production.channel, 'production');
  assert.equal(eas.build.preview.channel, 'preview');
  assert.equal(eas.build.preview.distribution, 'internal');
  assert.equal(eas.build['owner-home-internal'].android, undefined);
});
