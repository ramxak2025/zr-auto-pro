/**
 * app.config.js — dynamic layer on top of app.json.
 *
 * WHY THIS FILE EXISTS (Round 14, «нативных уведомлений нет»)
 * ==========================================================
 * The expo-notifications config plugin writes the `aps-environment` entitlement
 * from its `mode` prop, and its default is **'development'**:
 *
 *     const withNotificationsIOS = (config, { mode = 'development', ... })
 *
 * app.json declared the plugin with only icon/color, so every build — including
 * TestFlight and App Store — shipped `aps-environment: development`. Verified in
 * the generated ios/Autexa/Autexa.entitlements before this change.
 *
 * That single line is the whole outage: the app registers with the **sandbox**
 * APNs gateway, Expo delivers to **production** APNs, and the mismatch is
 * invisible — the Expo push ticket still comes back `ok` because a ticket only
 * means "queued". The real rejection (BadDeviceToken → DeviceNotRegistered)
 * appears solely in the delivery RECEIPT, which the backend never read until
 * this round. Result: no notifications, no errors, nothing to debug.
 *
 * `mode` cannot be a constant, though: a **development**-signed build must use
 * 'development' (a dev provisioning profile only carries that entitlement value,
 * so codesign fails with 'production'). Hence this file.
 *
 * RESOLUTION ORDER — deliberately fails SAFE (production):
 *   1. APS_ENV env var, when set to 'development' or 'production' (explicit
 *      override, used by eas.json's development profile);
 *   2. EAS_BUILD_PROFILE === 'development' → 'development';
 *   3. everything else → 'production'.
 *
 * Defaulting to 'production' is the point. If the env plumbing ever breaks, the
 * failure mode is "local dev build won't sign" (loud, instantly noticed) rather
 * than "TestFlight users silently get no pushes for months" (what just
 * happened). To build a dev client for a physical device locally:
 *
 *     APS_ENV=development npx expo prebuild --platform ios --clean
 *
 * The resolved value is mirrored into `extra.apsEnvironment` so it can be
 * verified without opening Xcode:
 *
 *     npx expo config --type prebuild | grep -i apsEnvironment
 *
 * and so the in-app diagnostics block can show the user which APNs environment
 * their build talks to.
 *
 * `enableBackgroundRemoteNotifications: true` is the second half of the fix: it
 * adds `remote-notification` to UIBackgroundModes. Info.plist had NO
 * UIBackgroundModes key at all, so the silent data pushes the backend sends for
 * cross-device cache invalidation (sendDataToTenant, `_contentAvailable: true`)
 * could never wake the app either.
 *
 * NOTE: changing this file changes native config → requires
 * `expo prebuild --clean` + `pod install` + a new build. OTA cannot ship it.
 */

/** @returns {'development' | 'production'} */
function resolveApsEnvironment() {
  const explicit = process.env.APS_ENV;
  if (explicit === 'development' || explicit === 'production') return explicit;
  if (process.env.EAS_BUILD_PROFILE === 'development') return 'development';
  return 'production';
}

/**
 * Merge the resolved APNs settings into the expo-notifications plugin entry
 * declared in app.json, leaving its icon/color exactly as authored there
 * (app.json stays the single declarative source for the visual props).
 */
function withNotificationsMode(plugins, apsEnvironment) {
  const list = Array.isArray(plugins) ? [...plugins] : [];
  const nativeProps = {
    mode: apsEnvironment,
    enableBackgroundRemoteNotifications: true,
  };

  const index = list.findIndex((entry) =>
    Array.isArray(entry) ? entry[0] === 'expo-notifications' : entry === 'expo-notifications',
  );

  if (index === -1) {
    // Plugin absent from app.json — declare it fully rather than silently
    // shipping a build with no aps-environment at all.
    list.push(['expo-notifications', nativeProps]);
    return list;
  }

  const entry = list[index];
  const existingProps = Array.isArray(entry) && entry[1] && typeof entry[1] === 'object' ? entry[1] : {};
  list[index] = ['expo-notifications', { ...existingProps, ...nativeProps }];
  return list;
}

module.exports = ({ config }) => {
  const apsEnvironment = resolveApsEnvironment();

  return {
    ...config,
    plugins: withNotificationsMode(config.plugins, apsEnvironment),
    extra: {
      ...(config.extra ?? {}),
      // Read at runtime by the «Уведомления» diagnostics block so the owner can
      // see, on the device, which APNs environment the installed build uses.
      apsEnvironment,
    },
  };
};
