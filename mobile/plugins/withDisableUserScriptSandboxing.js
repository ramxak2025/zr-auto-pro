/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * withDisableUserScriptSandboxing
 * --------------------------------------------------------------------------
 * Expo config plugin that turns OFF Xcode's "User Script Sandboxing" build
 * setting for every target in the generated ios/ Xcode project.
 *
 * Why this is necessary
 *   Xcode 15+ defaults `ENABLE_USER_SCRIPT_SANDBOXING = YES`, which prevents
 *   build-phase scripts from reading anywhere outside their own target's
 *   sandbox. React Native + Expo build-phase scripts (Metro bundler,
 *   Hermes, Pods) routinely walk across the whole `ios/` tree (Pods/,
 *   build/, source/), so sandboxing makes the build fail with errors like:
 *
 *     Sandbox: find(7934) deny(1) file-read-data /…/mobile/ios/Pods
 *
 *   The expo-build-properties plugin does NOT expose a flag for this yet
 *   (extraPodfileProps only writes into Podfile.properties.json, which is
 *   read by CocoaPods — not the same as a project-level build setting).
 *   So we patch the .pbxproj directly.
 *
 * What it changes
 *   For every native target in the project (the app target AND every Pod
 *   target after `pod install` regenerates them), set
 *   `ENABLE_USER_SCRIPT_SANDBOXING = NO` in both Debug and Release
 *   configurations.
 *
 * Survives prebuild --clean: yes — the plugin runs on every prebuild.
 */
const { withXcodeProject } = require('@expo/config-plugins');

const SANDBOX_KEY = 'ENABLE_USER_SCRIPT_SANDBOXING';

const withDisableUserScriptSandboxing = (config) => {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const configurations = project.pbxXCBuildConfigurationSection();

    for (const key of Object.keys(configurations)) {
      const buildConfig = configurations[key];
      // Skip comment entries (xcode lib stores them as siblings)
      if (!buildConfig || typeof buildConfig !== 'object') continue;
      if (!buildConfig.buildSettings) continue;

      buildConfig.buildSettings[SANDBOX_KEY] = 'NO';
    }

    return cfg;
  });
};

module.exports = withDisableUserScriptSandboxing;
