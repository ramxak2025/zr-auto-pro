const { withAndroidManifest } = require('@expo/config-plugins');

/** Expo's generic intentFilters helper always prepends android.intent.action.
 * NFC tags use the platform-specific android.nfc.action.NDEF_DISCOVERED name,
 * so normalize just that generated action and explicitly keep NFC optional. */
module.exports = function withNfcIntentManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const application = manifest.application?.[0];
    const activity = application?.activity?.find((item) => item.$?.['android:name'] === '.MainActivity');
    const filters = activity?.['intent-filter'] ?? [];
    for (const filter of filters) {
      for (const action of filter.action ?? []) {
        if (action.$?.['android:name'] === 'android.intent.action.NDEF_DISCOVERED') {
          action.$['android:name'] = 'android.nfc.action.NDEF_DISCOVERED';
        }
      }
    }
    const features = manifest['uses-feature'] ?? [];
    const nfc = features.find((feature) => feature.$?.['android:name'] === 'android.hardware.nfc');
    if (nfc) nfc.$['android:required'] = 'false';
    else
      manifest['uses-feature'] = [
        ...features,
        { $: { 'android:name': 'android.hardware.nfc', 'android:required': 'false' } },
      ];
    return modConfig;
  });
};
