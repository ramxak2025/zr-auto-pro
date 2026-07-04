/**
 * Ambient types for `react-native-audio-record` (ships no TypeScript types).
 *
 * Android-only usage (see react-native.config.js — iOS autolinking disabled).
 * It records raw 16-bit little-endian PCM via `AudioRecord` and, on `stop()`,
 * returns the path to a `.wav` container it wrote (44-byte PCM WAV header).
 */
declare module 'react-native-audio-record' {
  export interface AudioRecordOptions {
    /** Sample rate in Hz (we use 16000 for Yandex SpeechKit lpcm). */
    sampleRate?: number;
    /** Channel count (1 = mono). */
    channels?: number;
    /** Bits per sample (16). */
    bitsPerSample?: number;
    /**
     * Android `MediaRecorder.AudioSource` constant. 6 = VOICE_RECOGNITION,
     * which applies noise suppression tuned for speech-to-text.
     */
    audioSource?: number;
    /** Output wav filename (written into the app files dir). */
    wavFile?: string;
    /** Internal AudioRecord buffer size in bytes (optional). */
    bufferSize?: number;
  }

  export interface AudioRecordStatic {
    init(options: AudioRecordOptions): void;
    start(): void;
    /** Resolves with the absolute path to the recorded `.wav` file. */
    stop(): Promise<string>;
    /** Streams base64-encoded raw PCM chunks while recording. */
    on(event: 'data', callback: (data: string) => void): void;
  }

  const AudioRecord: AudioRecordStatic;
  export default AudioRecord;
}
