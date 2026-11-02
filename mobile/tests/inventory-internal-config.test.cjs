const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const base = require('../app.json').expo;
const eas = require('../eas.json');
const oldSource = require('node:fs').readFileSync(
  require.resolve('./fixtures/accepted-owner-home-app-config.cjs'),
  'utf8',
);
function resolve(env, source) {
  const context = { module: { exports: {} }, process: { env } };
  vm.runInNewContext(source, context);
  return JSON.parse(JSON.stringify(context.module.exports({ config: structuredClone(base) })));
}
const newSource = require('node:fs').readFileSync(require.resolve('../app.config.js'), 'utf8');
const stage = { AUTEXA_INVENTORY_INTERNAL: 'ios-v1' };

test('every ordinary profile and existing selector resolves byte-equivalent to accepted baseline', () => {
  for (const profile of [
    undefined,
    'production',
    'owner-home-internal',
    'preview',
    'development',
    'inventory-internal',
  ])
    for (const platform of [undefined, 'ios', 'android'])
      for (const selector of [{}, { AUTEXA_OWNER_HOME_RELEASE: 'ios-v1' }, { AUTEXA_OWNER_HOME_INTERNAL: 'ios-v1' }]) {
        const env = { ...selector, EAS_BUILD_PROFILE: profile, EAS_BUILD_PLATFORM: platform };
        assert.equal(JSON.stringify(resolve(env, newSource)), JSON.stringify(resolve(env, oldSource)));
      }
});
test('internal local and EAS worker resolve identically with only isolated API aliases', () => {
  const profile = eas.build['inventory-internal'];
  assert.deepEqual(profile, {
    distribution: 'store',
    channel: 'inventory-internal',
    autoIncrement: true,
    ios: { buildConfiguration: 'Release', env: stage },
  });
  const local = resolve(profile.ios.env, newSource);
  assert.deepEqual(
    resolve({ ...stage, EAS_BUILD_PROFILE: 'inventory-internal', EAS_BUILD_PLATFORM: 'ios' }, newSource),
    local,
  );
  assert.equal(local.version, '3.20.0');
  assert.equal(local.ios.runtimeVersion, '3.20.0-inventory-internal');
  assert.equal(local.ios.buildNumber, base.ios.buildNumber);
  assert.equal(local.extra.inventoryInternal, 'ios-v1');
  assert.equal(local.extra.ownerHomePilot, true);
  assert.equal(local.extra.inventoryPreview, true);
  assert.equal(local.extra.apiUrl, 'https://autexa.pw:8443/api');
  assert.deepEqual(local.extra.apiFallbackUrls, ['https://autexa-cloud.ru:8443/api']);
  assert.equal(local.extra.publicWebUrl, 'https://autexa.pw:8443');
  assert.deepEqual(local.android, base.android);
});
test('selector is exact, guarded by profile/platform, and mutually exclusive', () => {
  for (const env of [
    { AUTEXA_INVENTORY_INTERNAL: 'true' },
    { ...stage, EAS_BUILD_PROFILE: 'production' },
    { ...stage, EAS_BUILD_PROFILE: 'preview' },
    { ...stage, EAS_BUILD_PLATFORM: 'android' },
  ])
    assert.deepEqual(resolve(env, newSource), resolve(env, oldSource));
  for (const selector of ['AUTEXA_OWNER_HOME_RELEASE', 'AUTEXA_OWNER_HOME_INTERNAL'])
    assert.throws(() => resolve({ ...stage, [selector]: 'ios-v1' }, newSource), /INVENTORY_INTERNAL_SELECTOR_CONFLICT/);
});
