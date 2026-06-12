/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * withWidgetExtension — injects AuTexaWidget into the prebuild-generated
 * Xcode project. The `xcode` npm library used by config-plugins has two
 * gotchas this plugin works around:
 *   • Target lookups use the UUID as the dict key, not the human name —
 *     `{ target: 'AuTexaWidget' }` throws "Invalid target", but
 *     `{ target: <UUID> }` works.
 *   • `addTarget` stores the name quoted (`"AuTexaWidget"`) and creates
 *     ONLY a Copy Files phase in the FIRST target (the embed for the
 *     extension). It does NOT create Sources/Frameworks/Resources phases
 *     for the new target — we have to create them manually before any
 *     `addSourceFile` / `addFramework` will work.
 */
const { withXcodeProject, withEntitlementsPlist } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const WIDGET_TARGET = 'AuTexaWidget';
const APP_GROUP = 'group.com.autexa.mobile';
const WIDGET_BUNDLE_ID = 'com.autexa.mobile.widget';
const DEPLOYMENT_TARGET = '17.0';
// Apple Developer Team for owner Ramazan Shamsudinov. MUST be the PAID
// team 98SHYK65HQ (the OU of the installed distribution cert) — NOT the
// free Personal Team XHTQCBD2K4, which produces the 7-day "Unable to
// Verify App" nag and cannot provision com.autexa.mobile.widget on EAS.
// Setting it on the widget target via the plugin avoids the "Signing for
// AuTexaWidget requires a development team" error after prebuild --clean.
const DEVELOPMENT_TEAM = '98SHYK65HQ';
const SRC_DIR = path.join(__dirname, '..', 'ios-extensions', 'AuTexaWidget');

function copyWidgetFiles(iosRoot) {
  const dest = path.join(iosRoot, WIDGET_TARGET);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const f of fs.readdirSync(SRC_DIR)) {
    fs.copyFileSync(path.join(SRC_DIR, f), path.join(dest, f));
  }
}

function writeWidgetEntitlements(iosRoot) {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.application-groups</key>
    <array>
        <string>${APP_GROUP}</string>
    </array>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(iosRoot, WIDGET_TARGET, `${WIDGET_TARGET}.entitlements`), content);
}

// ── A) App Groups entitlement on main app ─────────────────────────────────────

const withAppGroups = (config) =>
  withEntitlementsPlist(config, (mod) => {
    const ents = mod.modResults;
    if (!Array.isArray(ents['com.apple.security.application-groups'])) {
      ents['com.apple.security.application-groups'] = [];
    }
    if (!ents['com.apple.security.application-groups'].includes(APP_GROUP)) {
      ents['com.apple.security.application-groups'].push(APP_GROUP);
    }
    return mod;
  });

// ── B) Add widget target to Xcode project ─────────────────────────────────────

const withWidgetTarget = (config) =>
  withXcodeProject(config, (mod) => {
    const projectRoot = mod.modRequest.projectRoot;
    const iosRoot = path.join(projectRoot, 'ios');

    copyWidgetFiles(iosRoot);
    writeWidgetEntitlements(iosRoot);

    const proj = mod.modResults;

    // Idempotent guard. xcode lib stores target name quoted, so match both.
    const existingTargets = proj.pbxNativeTargetSection();
    const alreadyAdded = Object.values(existingTargets).some((t) => {
      if (!t || typeof t !== 'object') return false;
      const name = (t.name || '').replace(/^"|"$/g, '');
      return name === WIDGET_TARGET;
    });
    if (alreadyAdded) {
      return mod;
    }

    // 1. Create the target. For 'app_extension' addTarget ALSO creates a
    //    Copy Files build phase in the first (main) target that embeds the
    //    widget .appex. So we DO NOT add an "Embed App Extensions" phase
    //    ourselves — that would create a duplicate.
    const widgetTarget = proj.addTarget(WIDGET_TARGET, 'app_extension', WIDGET_TARGET, WIDGET_BUNDLE_ID);
    const widgetTargetUuid = widgetTarget.uuid;

    // 2. addTarget leaves buildPhases empty on the new target. Source files,
    //    frameworks, and resources all need their phases to exist BEFORE they
    //    can be attached. Create them with empty file lists.
    proj.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', widgetTargetUuid);
    proj.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', widgetTargetUuid);
    proj.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', widgetTargetUuid);

    // 3. Create a PBXGroup for the widget folder so the files show up in the
    //    Xcode navigator under "AuTexaWidget".
    const widgetGroupResult = proj.addPbxGroup([], WIDGET_TARGET, WIDGET_TARGET, '"<group>"');
    const widgetGroupKey = widgetGroupResult.uuid;

    const mainGroupKey = proj.getFirstProject().firstProject.mainGroup;
    const mainGroup = proj.getPBXGroupByKey(mainGroupKey);
    if (mainGroup && Array.isArray(mainGroup.children)) {
      mainGroup.children.push({ value: widgetGroupKey, comment: WIDGET_TARGET });
    }

    // 4. Add the Swift source files. Pass the target UUID, NOT the target
    //    name string. The xcode lib looks up the target with
    //    `nativeTargets[opt.target]` which is a UUID-keyed dict.
    //
    //    Path semantics: the group above was created with `path: 'AuTexaWidget'`,
    //    so any file added to it inherits that prefix. We pass BARE filenames
    //    here — otherwise we'd get the double `AuTexaWidget/AuTexaWidget/...`
    //    that fails the build.
    const swiftFiles = fs.readdirSync(path.join(iosRoot, WIDGET_TARGET)).filter((f) => f.endsWith('.swift'));

    for (const file of swiftFiles) {
      proj.addSourceFile(file, { target: widgetTargetUuid }, widgetGroupKey);
    }

    // Info.plist and entitlements: file refs only (no build phase).
    proj.addFile('Info.plist', widgetGroupKey, {});
    proj.addFile(`${WIDGET_TARGET}.entitlements`, widgetGroupKey, {});

    // 5. Patch the widget target's Debug + Release build configs.
    //    addTarget assigns each XCBuildConfiguration entry a *_comment that
    //    starts with the target's quoted name, e.g.:
    //      ABCD1234_comment = "Build configuration list for PBXNativeTarget \"AuTexaWidget\""
    const allBuildConfigs = proj.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(allBuildConfigs)) {
      const cfg = allBuildConfigs[key];
      if (!cfg || typeof cfg !== 'object' || !cfg.buildSettings) continue;
      if (cfg.name !== 'Debug' && cfg.name !== 'Release') continue;

      // We need to figure out if this config belongs to our widget. The
      // XCConfigurationList for our target is referenced by widgetTarget's
      // pbxNativeTarget.buildConfigurationList; that list's `buildConfigurations`
      // array contains UUIDs that match keys in this section.
      const targetCfgList =
        proj.hash.project.objects.XCConfigurationList[widgetTarget.pbxNativeTarget.buildConfigurationList];
      if (!targetCfgList || !Array.isArray(targetCfgList.buildConfigurations)) continue;
      const ourConfigUuids = targetCfgList.buildConfigurations.map((c) => c.value);
      if (!ourConfigUuids.includes(key)) continue;

      const bs = cfg.buildSettings;
      bs.SWIFT_VERSION = '5.0';
      bs.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
      bs.INFOPLIST_FILE = `"${WIDGET_TARGET}/Info.plist"`;
      bs.CODE_SIGN_ENTITLEMENTS = `"${WIDGET_TARGET}/${WIDGET_TARGET}.entitlements"`;
      bs.PRODUCT_NAME = `"${WIDGET_TARGET}"`;
      bs.PRODUCT_BUNDLE_IDENTIFIER = `"${WIDGET_BUNDLE_ID}"`;
      bs.SKIP_INSTALL = 'YES';
      bs.TARGETED_DEVICE_FAMILY = '"1,2"';
      bs.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
      bs.CLANG_ENABLE_MODULES = 'YES';
      bs.SWIFT_EMIT_LOC_STRINGS = 'YES';
      bs.GENERATE_INFOPLIST_FILE = 'NO';
      bs.MARKETING_VERSION = '1.0';
      bs.CURRENT_PROJECT_VERSION = '1';
      // Signing: Automatic, same team as main app
      bs.DEVELOPMENT_TEAM = DEVELOPMENT_TEAM;
      bs.CODE_SIGN_STYLE = 'Automatic';
    }

    // 6. Link WidgetKit + SwiftUI (target UUID, not name).
    proj.addFramework('WidgetKit.framework', { target: widgetTargetUuid });
    proj.addFramework('SwiftUI.framework', { target: widgetTargetUuid });

    // 7. Main target depends on widget target so Xcode builds them in order.
    const mainTarget = proj.getFirstTarget();
    if (mainTarget && mainTarget.uuid) {
      proj.addTargetDependency(mainTarget.uuid, [widgetTargetUuid]);
    }

    // 8. Stamp DEVELOPMENT_TEAM + CODE_SIGN_STYLE on EVERY XCBuildConfiguration
    //    (main app + widget). Expo's prebuild doesn't set DEVELOPMENT_TEAM on
    //    the main Autexa target, so on a fresh `prebuild --clean` Xcode shows
    //    "Signing for 'Autexa' requires a development team" until the owner
    //    sets it by hand. This loop bakes the team in for both targets.
    const allConfigsForTeam = proj.pbxXCBuildConfigurationSection();
    for (const k of Object.keys(allConfigsForTeam)) {
      const cfg = allConfigsForTeam[k];
      if (!cfg || typeof cfg !== 'object' || !cfg.buildSettings) continue;
      if (cfg.name !== 'Debug' && cfg.name !== 'Release') continue;
      cfg.buildSettings.DEVELOPMENT_TEAM = DEVELOPMENT_TEAM;
      cfg.buildSettings.CODE_SIGN_STYLE = 'Automatic';
    }

    return mod;
  });

module.exports = (config) => {
  config = withAppGroups(config);
  config = withWidgetTarget(config);
  return config;
};
