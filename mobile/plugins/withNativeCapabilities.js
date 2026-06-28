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
const { withXcodeProject } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const APP_INTENTS_SRC = path.join(__dirname, '..', 'ios-app-intents', 'AutexaAppIntents.swift');
const APP_INTENTS_FILENAME = 'AutexaAppIntents.swift';

function stripQuotes(s) {
  return (s || '').replace(/^"|"$/g, '');
}

function alreadyAdded(proj) {
  const refs = proj.pbxFileReferenceSection();
  return Object.values(refs).some((r) => {
    if (!r || typeof r !== 'object') return false;
    return stripQuotes(r.path || r.name).endsWith(APP_INTENTS_FILENAME);
  });
}

const withNativeCapabilities = (config) =>
  withXcodeProject(config, (mod) => {
    const iosRoot = path.join(mod.modRequest.projectRoot, 'ios');
    const proj = mod.modResults;

    // Idempotent guard — never add the source / frameworks twice.
    if (alreadyAdded(proj)) {
      return mod;
    }

    // 1. Copy the App Intents source to the ios ROOT. We attach it to the
    //    project's main group (which resolves to SOURCE_ROOT = ios/), so a
    //    bare filename resolves to ios/AutexaAppIntents.swift deterministically
    //    — independent of how Expo names the per-app PBXGroup.
    fs.copyFileSync(APP_INTENTS_SRC, path.join(iosRoot, APP_INTENTS_FILENAME));

    // 2. Resolve the main app target (first target) + the project main group.
    const mainTarget = proj.getFirstTarget();
    const mainTargetUuid = mainTarget.uuid;
    const mainGroupKey = proj.getFirstProject().firstProject.mainGroup;

    // 3. Add the Swift file to the main target's Sources build phase.
    proj.addSourceFile(APP_INTENTS_FILENAME, { target: mainTargetUuid }, mainGroupKey);

    // 4. Weak-link the iOS-16 frameworks into the app binary.
    proj.addFramework('AppIntents.framework', { target: mainTargetUuid, weak: true });
    proj.addFramework('ActivityKit.framework', { target: mainTargetUuid, weak: true });

    return mod;
  });

module.exports = withNativeCapabilities;
