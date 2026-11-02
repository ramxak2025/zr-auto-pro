/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * withNativeCapabilities — wires the iOS-native premium layer that lives in
 * the MAIN app target (as opposed to the widget extension, which
 * withWidgetExtension.js owns):
 *
 *   1. Compiles ios-app-intents/AutexaAppIntents.swift into the Autexa app
 *      target. App Shortcuts (AppShortcutsProvider) MUST be in the app
 *      target — not an extension — to be discovered by Siri / Spotlight.
 *
 *   2. Weak-links AppIntents.framework (iOS 16) and ActivityKit.framework
 *      (iOS 16.1). The app deploys to iOS 15.1; ActivityKit is autolinked
 *      strongly by the autexa-liquid-glass pod (AutexaLiveActivityModule),
 *      and AppIntents by the source above. A STRONG link to a framework
 *      that doesn't exist on iOS 15 crashes the app at launch on the
 *      missing dylib. Every Swift symbol that touches these frameworks is
 *      @available(iOS 16.x, *)-guarded, so weak-linking is safe and correct.
 *
 * The xcode-lib gotchas worked around here mirror withWidgetExtension.js:
 *   • target lookups are by UUID, and addSourceFile / addFramework take the
 *     target UUID via { target: <uuid> };
 *   • the source file is added to the existing "Autexa" PBXGroup (path
 *     "Autexa") with a BARE filename, so it resolves to ios/Autexa/<file>.
 */
const { withXcodeProject, withInfoPlist } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const APP_INTENTS_SRC = path.join(__dirname, '..', 'ios-app-intents', 'AutexaAppIntents.swift');
const APP_INTENTS_FILENAME = 'AutexaAppIntents.swift';

function stripQuotes(s) {
  return (s || '').replace(/^"|"$/g, '');
}

function alreadyAdded(proj, filename = APP_INTENTS_FILENAME) {
  const refs = proj.pbxFileReferenceSection();
  return Object.values(refs).some((r) => {
    if (!r || typeof r !== 'object') return false;
    return stripQuotes(r.path || r.name).endsWith(filename);
  });
}

const withNativeCapabilities = (config) =>
  withXcodeProject(config, (mod) => {
    const iosRoot = path.join(mod.modRequest.projectRoot, 'ios');
    const proj = mod.modResults;

    const hadAppIntents = alreadyAdded(proj);
    const mainTarget = proj.getFirstTarget();
    const mainTargetUuid = mainTarget.uuid;
    const mainGroupKey = proj.getFirstProject().firstProject.mainGroup;
    const files = [
      [APP_INTENTS_SRC, APP_INTENTS_FILENAME],
      [
        path.join(__dirname, '..', 'ios-extensions', 'AuTexaWidget', 'AutexaNativeEnvironment.swift'),
        'AutexaAppNativeEnvironment.swift',
      ],
    ];
    for (const [source, filename] of files) {
      // Refresh guards even in an incremental prebuild; add references once.
      fs.copyFileSync(source, path.join(iosRoot, filename));
      if (!alreadyAdded(proj, filename)) proj.addSourceFile(filename, { target: mainTargetUuid }, mainGroupKey);
    }
    if (hadAppIntents) return mod;

    // 4. Weak-link the iOS-16 frameworks into the app binary.
    proj.addFramework('AppIntents.framework', { target: mainTargetUuid, weak: true });
    proj.addFramework('ActivityKit.framework', { target: mainTargetUuid, weak: true });

    return mod;
  });

module.exports = (config) =>
  withNativeCapabilities(
    withInfoPlist(config, (mod) => {
      if (mod.extra?.inventoryInternal === 'ios-v1') mod.modResults.AutexaInventoryInternal = true;
      else delete mod.modResults.AutexaInventoryInternal;
      return mod;
    }),
  );
