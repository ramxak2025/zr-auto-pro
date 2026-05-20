/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * withAndroidPredictiveBack
 * --------------------------------------------------------------------------
 * Expo config plugin that PINS Android's predictive-back flag to "false"
 * by writing `android:enableOnBackInvokedCallback="false"` onto the
 * `<application>` tag.
 *
 * Why opt out (for now)
 *   We previously opted IN to predictive back (true). On Android 13+ with
 *   New Architecture + react-native-screens ≥ 4.x, the new
 *   OnBackInvokedDispatcher API was not consistently receiving callbacks
 *   from every nested native-stack — so swiping back inside e.g.
 *   MoreTab → Schedule terminated the activity instead of popping. From
 *   the owner's perspective: "swipe back minimizes the app". Falling
 *   back to the legacy onBackPressedDispatcher fixes that — every stack
 *   pops cleanly, the OS only exits the app when the root tab has no
 *   history.
 *
 *   We keep this as an explicit `false` (rather than removing the plugin)
 *   so anybody investigating the back gesture finds this rationale and
 *   doesn't silently flip the value back to `true` without verifying
 *   the whole nav tree.
 *
 * Survives `expo prebuild --clean`: yes — the plugin runs on every
 * prebuild, no manual edits to android/ required.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

const withAndroidPredictiveBack = (config) => {
  return withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (application?.$) {
      application.$['android:enableOnBackInvokedCallback'] = 'false';
    }
    return cfg;
  });
};

module.exports = withAndroidPredictiveBack;
