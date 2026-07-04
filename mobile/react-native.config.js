/**
 * React Native / Expo autolinking overrides.
 *
 * `react-native-audio-record` is used ONLY on Android — it is the raw 16-bit LE
 * PCM (AudioRecord) path for the voice-comment feature, because expo-audio on
 * Android is MediaRecorder-only and cannot emit LPCM/WAV (Yandex SpeechKit v1
 * `lpcm` needs headerless raw PCM). On iOS we record LPCM through expo-audio's
 * `IOSOutputFormat.LINEARPCM`, so this pod must NOT link into the iOS target.
 *
 * Disabling its iOS autolinking keeps the priority iOS build completely
 * insulated from this legacy dependency (no extra pod, no New-Arch surprises).
 * The JS wrapper is required lazily inside the Android-only code path, so the
 * absent iOS native module is never touched at runtime either.
 */
module.exports = {
  dependencies: {
    'react-native-audio-record': {
      platforms: {
        ios: null,
      },
    },
  },
};
