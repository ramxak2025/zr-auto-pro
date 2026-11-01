const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mobile = path.resolve(__dirname, '..');
function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 120_000, ...options });
  assert.equal(result.status, 0, `${executable} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function plist(file) {
  return JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', file]));
}

test(
  'actual Expo prebuild stamps each target only internally and removes the marker on return to public',
  { timeout: 180_000, skip: process.platform !== 'darwin' },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autexa-native-environment-'));
    try {
      for (const name of [
        'package.json',
        'package-lock.json',
        'app.json',
        'app.config.js',
        'assets',
        'plugins',
        'modules',
        'ios-app-intents',
        'ios-extensions',
      ]) {
        fs.cpSync(path.join(mobile, name), path.join(root, name), { recursive: true });
      }
      fs.symlinkSync(fs.realpathSync(path.join(mobile, 'node_modules')), path.join(root, 'node_modules'), 'dir');
      const env = { ...process.env, CI: '1', EXPO_OFFLINE: '1', EXPO_NO_DOTENV: '1', EXPO_NO_GIT_STATUS: '1' };
      for (const key of [
        'AUTEXA_OWNER_HOME_RELEASE',
        'AUTEXA_OWNER_HOME_INTERNAL',
        'AUTEXA_INVENTORY_INTERNAL',
        'EAS_BUILD_PROFILE',
        'EAS_BUILD_PLATFORM',
      ])
        delete env[key];
      const cli = path.join(mobile, 'node_modules/expo/bin/cli');
      const template = path.join(mobile, 'node_modules/expo/template.tgz');
      const prebuild = (internal, clean) => {
        const stageEnv = {
          ...env,
          ...(internal
            ? {
                AUTEXA_INVENTORY_INTERNAL: 'ios-v1',
                EAS_BUILD_PROFILE: 'inventory-internal',
                EAS_BUILD_PLATFORM: 'ios',
              }
            : {}),
        };
        run(
          process.execPath,
          [cli, 'prebuild', '--platform', 'ios', '--no-install', '--template', template, ...(clean ? ['--clean'] : [])],
          { cwd: root, env: stageEnv },
        );
        const main = plist(path.join(root, 'ios/Autexa/Info.plist'));
        const widget = plist(path.join(root, 'ios/AuTexaWidget/Info.plist'));
        assert.equal(main.AutexaInventoryInternal, internal ? true : undefined);
        assert.equal(widget.AutexaInventoryInternal, internal ? true : undefined);
        const project = fs.readFileSync(path.join(root, 'ios/Autexa.xcodeproj/project.pbxproj'), 'utf8');
        assert.match(project, /AutexaAppNativeEnvironment.swift in Sources/);
        assert.match(project, /AutexaNativeEnvironment.swift in Sources/);
        const helper = fs.readFileSync(
          path.join(mobile, 'ios-extensions/AuTexaWidget/AutexaNativeEnvironment.swift'),
          'utf8',
        );
        assert.equal(fs.readFileSync(path.join(root, 'ios/AutexaAppNativeEnvironment.swift'), 'utf8'), helper);
        assert.equal(
          fs.readFileSync(path.join(root, 'ios/AuTexaWidget/AutexaNativeEnvironment.swift'), 'utf8'),
          helper,
        );
      };
      prebuild(false, true);
      prebuild(true, false);
      prebuild(false, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'compiled Foundation native queue, revenue and widget paths never open public defaults internally',
  { skip: process.platform !== 'darwin' },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autexa-native-swift-'));
    try {
      const binary = path.join(root, 'native-isolation');
      run('xcrun', [
        'swiftc',
        '-module-cache-path',
        path.join(root, 'cache'),
        path.join(mobile, 'ios-extensions/AuTexaWidget/AutexaNativeEnvironment.swift'),
        path.join(__dirname, 'fixtures/native-environment-main.swift'),
        '-o',
        binary,
      ]);
      assert.match(run(binary, []), /PASS native isolation/);
      // Verify the actual AppIntent and WidgetKit entry points compile against
      // iOS frameworks with the shared guards, without building/signing an app.
      const sdk = run('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path']).trim();
      const base = [
        'swiftc',
        '-typecheck',
        '-module-cache-path',
        path.join(root, 'ios-cache'),
        '-sdk',
        sdk,
        '-target',
        'arm64-apple-ios17.0-simulator',
      ];
      const helper = path.join(mobile, 'ios-extensions/AuTexaWidget/AutexaNativeEnvironment.swift');
      run('xcrun', [...base, helper, path.join(mobile, 'ios-app-intents/AutexaAppIntents.swift')]);
      run('xcrun', [...base, helper, path.join(mobile, 'ios-extensions/AuTexaWidget/AuTexaWidget.swift')]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
