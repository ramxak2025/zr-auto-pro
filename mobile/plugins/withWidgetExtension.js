/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * withWidgetExtension
 * --------------------------------------------------------------------------
 * Expo config plugin that injects the AuTexaWidget WidgetKit extension into
 * the generated ios/ Xcode project.
 *
 * What it does
 *   1. Copies ios-extensions/AuTexaWidget/*.swift + Info.plist into
 *      ios/AuTexaWidget/ at prebuild time.
 *   2. Creates a new Xcode target (app_extension) for the widget.
 *   3. Adds WidgetKit.framework and SwiftUI.framework to the widget target.
 *   4. Adds a "Embed App Extensions" CopyFiles build phase to the main app
 *      target so the widget is bundled inside the .app at build time.
 *   5. Adds App Groups entitlement (group.com.autexa.mobile) to the main
 *      app target via withEntitlementsPlist.
 *   6. Writes ios/AuTexaWidget/AuTexaWidget.entitlements so the widget
 *      shares the same App Group.
 *
 * Survives prebuild --clean: yes — runs on every prebuild.
 */
const { withXcodeProject, withEntitlementsPlist } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const WIDGET_TARGET = 'AuTexaWidget';
const APP_GROUP = 'group.com.autexa.mobile';
const WIDGET_BUNDLE_ID = 'com.autexa.mobile.widget';
const DEPLOYMENT_TARGET = '16.0';
const SRC_DIR = path.join(__dirname, '..', 'ios-extensions', 'AuTexaWidget');

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Copy the committed widget source files from ios-extensions/ into ios/AuTexaWidget/
 * so Xcode can find them during the build.
 */
function copyWidgetFiles(iosRoot) {
  const dest = path.join(iosRoot, WIDGET_TARGET);
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  for (const f of fs.readdirSync(SRC_DIR)) {
    fs.copyFileSync(path.join(SRC_DIR, f), path.join(dest, f));
  }
}

/**
 * Write the widget's entitlements file granting access to the shared App Group.
 */
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
  fs.writeFileSync(
    path.join(iosRoot, WIDGET_TARGET, `${WIDGET_TARGET}.entitlements`),
    content
  );
}

// ── Step A: add App Groups to main app entitlements ──────────────────────────

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

// ── Step B: add widget target to Xcode project ───────────────────────────────

const withWidgetTarget = (config) =>
  withXcodeProject(config, (mod) => {
    const projectRoot = mod.modRequest.projectRoot;
    const iosRoot = path.join(projectRoot, 'ios');

    // 1. Copy source files into ios/AuTexaWidget/
    copyWidgetFiles(iosRoot);
    writeWidgetEntitlements(iosRoot);

    const proj = mod.modResults;

    // 2. Guard: skip if target already registered (idempotent)
    const existingTargets = proj.pbxNativeTargetSection();
    const alreadyAdded = Object.values(existingTargets).some(
      (t) => t && typeof t === 'object' && t.name === WIDGET_TARGET
    );
    if (alreadyAdded) {
      return mod;
    }

    // 3. Create the widget target FIRST — addSourceFile needs the target to
    //    already exist in pbxNativeTargetSection so it can find it by name.
    const widgetTarget = proj.addTarget(
      WIDGET_TARGET,
      'app_extension',
      WIDGET_TARGET,
      WIDGET_BUNDLE_ID
    );
    const widgetTargetUuid = widgetTarget.uuid;

    // 4. Add Xcode group for the widget folder
    const widgetGroupResult = proj.addPbxGroup([], WIDGET_TARGET, WIDGET_TARGET, '"<group>"');
    const widgetGroupKey = widgetGroupResult.uuid;

    // Add the group as a child of the root project group so it appears in navigator.
    const mainGroupKey = proj.getFirstProject().firstProject.mainGroup;
    const mainGroup = proj.getPBXGroupByKey(mainGroupKey);
    if (mainGroup && Array.isArray(mainGroup.children)) {
      mainGroup.children.push({ value: widgetGroupKey, comment: WIDGET_TARGET });
    }

    // 5. Add Swift files + Info.plist + entitlements to the group.
    //    Target now exists so addSourceFile can attach to its Sources build phase.
    const swiftFiles = fs
      .readdirSync(path.join(iosRoot, WIDGET_TARGET))
      .filter((f) => f.endsWith('.swift'));

    for (const file of swiftFiles) {
      proj.addSourceFile(
        `${WIDGET_TARGET}/${file}`,
        { target: WIDGET_TARGET },
        widgetGroupKey
      );
    }
    proj.addFile(`${WIDGET_TARGET}/Info.plist`, widgetGroupKey, {});
    proj.addFile(`${WIDGET_TARGET}/${WIDGET_TARGET}.entitlements`, widgetGroupKey, {});

    // 6. Patch build settings for Debug + Release configs of the widget target
    const allBuildConfigs = proj.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(allBuildConfigs)) {
      const config = allBuildConfigs[key];
      if (!config || typeof config !== 'object' || !config.buildSettings) continue;
      if (config.name !== 'Debug' && config.name !== 'Release') continue;

      // Only patch configs that belong to our new widget target.
      // The xcode lib attaches the target uuid to the config comment.
      const commentKey = `${key}_comment`;
      const comment = allBuildConfigs[commentKey] || '';
      if (
        typeof comment !== 'string' ||
        !comment.includes(WIDGET_TARGET)
      ) {
        continue;
      }

      const bs = config.buildSettings;
      bs['SWIFT_VERSION'] = '5.0';
      bs['IPHONEOS_DEPLOYMENT_TARGET'] = DEPLOYMENT_TARGET;
      bs['INFOPLIST_FILE'] = `"${WIDGET_TARGET}/Info.plist"`;
      bs['CODE_SIGN_ENTITLEMENTS'] = `"${WIDGET_TARGET}/${WIDGET_TARGET}.entitlements"`;
      bs['PRODUCT_NAME'] = `"${WIDGET_TARGET}"`;
      bs['PRODUCT_BUNDLE_IDENTIFIER'] = `"${WIDGET_BUNDLE_ID}"`;
      bs['SKIP_INSTALL'] = 'YES';
      bs['TARGETED_DEVICE_FAMILY'] = '"1,2"';
      // New Architecture compatibility
      bs['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO';
    }

    // 7. Add WidgetKit and SwiftUI frameworks to the widget target
    proj.addFramework('WidgetKit.framework', {
      weak: false,
      target: widgetTargetUuid,
    });
    proj.addFramework('SwiftUI.framework', {
      weak: false,
      target: widgetTargetUuid,
    });

    // 8. Add a dependency from the main app target → widget target so Xcode
    //    builds the widget when building the app.
    const mainTarget = proj.getFirstTarget();
    if (mainTarget && mainTarget.uuid) {
      proj.addTargetDependency(mainTarget.uuid, [widgetTargetUuid]);

      // 9. Add "Embed App Extensions" CopyFiles build phase to the main target
      //    so the widget .appex is copied into the .app bundle at archive time.
      proj.addBuildPhase(
        [`${WIDGET_TARGET}.appex`],
        'PBXCopyFilesBuildPhase',
        'Embed App Extensions',
        mainTarget.uuid,
        'app_extension'
      );
    }

    return mod;
  });

// ── Compose ──────────────────────────────────────────────────────────────────

module.exports = (config) => {
  config = withAppGroups(config);
  config = withWidgetTarget(config);
  return config;
};
