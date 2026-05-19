/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * withAndroidPredictiveBack
 * --------------------------------------------------------------------------
 * Expo config plugin that flips Android's Predictive Back to ON by setting
 * `android:enableOnBackInvokedCallback="true"` on the `<application>` tag.
 *
 * Why
 *   Android 13 (API 33) introduced the predictive back gesture — a small
 *   preview animation that lets the user peek where they're about to go
 *   when swiping back. Enabling it is the M3 / Material You convention
 *   and matches the iOS edge-swipe peek that users on a recent iPhone
 *   are used to. Expo's default Manifest writes
 *   `enableOnBackInvokedCallback="false"` to stay compatible with all
 *   plugins; we explicitly opt in.
 *
 * Compatibility
 *   React Navigation's native stack supports the
 *   `OnBackInvokedCallback` API since 6.1.x; `react-native-screens` ≥ 3.32
 *   forwards the callback automatically when New Architecture is on. We
 *   already have New Arch enabled, so flipping this flag should NOT
 *   regress: pre-API-33 phones simply ignore the attribute.
 *
 * Survives `expo prebuild --clean`: yes — the plugin runs on every
 * prebuild, no manual edits to android/ required.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const withAndroidPredictiveBack = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (application?.$) {
      application.$['android:enableOnBackInvokedCallback'] = 'true';
    }
    return cfg;
  });
};

module.exports = withAndroidPredictiveBack;
