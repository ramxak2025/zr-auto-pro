/**
 * Voice-comment recorder: produces raw 16-bit little-endian PCM (mono, 16 kHz)
 * ready to upload to POST /voice/transcribe as `format=lpcm`, matching what the
 * backend forwards to Yandex SpeechKit v1 (see utils/wavPcm.ts for the WHY).
 *
 * Per-platform recording engine (both normalise to raw LPCM via a `.wav` file):
 *   • iOS     — expo-audio `IOSOutputFormat.LINEARPCM` (AVAudioRecorder → WAV).
 *   • Android — react-native-audio-record (AudioRecord → WAV). expo-audio on
 *     Android is MediaRecorder-only and cannot emit LPCM/WAV, so it is unusable
 *     for the lpcm contract. The lib is lazily imported ONLY on Android and is
 *     excluded from iOS autolinking (react-native.config.js), keeping the iOS
 *     build fully insulated.
 *
 * On stop we read the WAV bytes, strip the RIFF header down to the `data` chunk
 * and write a headerless `.pcm` temp file whose URI is uploaded via FormData.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  useAudioRecorder,
  useAudioRecorderState,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  AudioQuality,
  IOSOutputFormat,
  type RecordingOptions,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { extractPcmFromWav } from './wavPcm';

/** Yandex SpeechKit v1 lpcm sample rate (its valid set is 8000|16000|48000). */
export const VOICE_SAMPLE_RATE = 16000;

/**
 * ПРЕДОХРАНИТЕЛЬ ПРОТИВ OTA-КРАША (инцидент 2026-07-05).
 *
 * Разрешение микрофона ЗАШИВАЕТСЯ в бинарник при сборке: iOS ≥ 37 несёт
 * NSMicrophoneUsageDescription, Android ≥ 68 — разблокированный RECORD_AUDIO.
 * НО OTA-бандл (runtimeVersion 3.0.0) прилетает и на СТАРЫЕ сборки — а iOS
 * УБИВАЕТ приложение (TCC) за обращение к микрофону без plist-ключа. Manifest
 * OTA-обновления врёт про бинарник (несёт НОВЫЙ app.json), поэтому единственный
 * честный источник — нативный номер сборки из бинарника (expo-application).
 * Кнопка голоса рендерится только там, где разрешение реально зашито.
 */
const VOICE_MIN_NATIVE_BUILD_IOS = 37;
const VOICE_MIN_NATIVE_BUILD_ANDROID = 68;

export function isVoiceNativeReady(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Application = require('expo-application') as { nativeBuildVersion?: string | null };
    const build = parseInt(Application.nativeBuildVersion || '0', 10);
    if (!Number.isFinite(build) || build <= 0) return false;
    return build >= (Platform.OS === 'ios' ? VOICE_MIN_NATIVE_BUILD_IOS : VOICE_MIN_NATIVE_BUILD_ANDROID);
  } catch {
    return false; // fail-closed: нет данных о бинарнике — микрофон не показываем
  }
}
/**
 * Soft record cap. Yandex v1 *sync* recognition officially accepts ≤30 s / 1 МБ;
 * raw 16 kHz mono 16-bit PCM is 32000 B/s, so 30 s ≈ 960 КБ — safely under both
 * the 1 МБ Yandex ceiling and the backend's 2 МБ busboy limit.
 */
export const VOICE_MAX_DURATION_SEC = 30;
/** Below this (~0.06 s) a clip is an accidental tap — treated as "too short". */
const MIN_PCM_BYTES = 2000;
/** dBFS floor for mapping iOS metering → 0..1 waveform level. */
const METERING_FLOOR_DB = 50;

const IOS_LPCM_OPTIONS: RecordingOptions = {
  isMeteringEnabled: true,
  extension: '.wav',
  sampleRate: VOICE_SAMPLE_RATE,
  numberOfChannels: 1,
  bitRate: VOICE_SAMPLE_RATE * 16, // informational for PCM
  ios: {
    extension: '.wav',
    outputFormat: IOSOutputFormat.LINEARPCM,
    audioQuality: AudioQuality.HIGH,
    sampleRate: VOICE_SAMPLE_RATE,
    bitDepthHint: 16,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  // Android never records through expo-audio for this feature — but
  // useAudioRecorder() auto-prepares on mount, so give it a VALID compressed
  // config to avoid a benign prepare error. This recorder is never started.
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    sampleRate: VOICE_SAMPLE_RATE,
  },
  web: {
    mimeType: 'audio/wav',
    bitsPerSecond: VOICE_SAMPLE_RATE * 16,
  },
};

/** Multipart-ready raw-PCM result. Caller uploads then calls `cleanup()`. */
export interface VoicePcmResult {
  uri: string;
  name: string;
  type: string;
  durationSeconds: number;
  sampleRate: number;
  byteLength: number;
  cleanup: () => void;
}

/** Thrown by `start()` when the microphone permission is not granted. */
export class VoicePermissionError extends Error {
  canAskAgain: boolean;
  constructor(canAskAgain: boolean) {
    super('microphone permission denied');
    this.name = 'VoicePermissionError';
    this.canAskAgain = canAskAgain;
  }
}

export interface VoiceRecorderApi {
  isRecording: boolean;
  durationMs: number;
  /** 0..1 amplitude for the waveform (iOS metering; synthetic pulse on Android). */
  level: number;
  start: () => Promise<void>;
  stop: () => Promise<VoicePcmResult | null>;
  cancel: () => Promise<void>;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

async function wavUriToPcm(wavUri: string): Promise<Uint8Array | null> {
  try {
    const bytes = await new File(wavUri).bytes();
    return extractPcmFromWav(bytes);
  } catch {
    return null;
  }
}

function writePcmTempFile(pcm: Uint8Array): File {
  const file = new File(Paths.cache, `autexa-voice-${Date.now()}-${Math.floor(Math.random() * 1e6)}.pcm`);
  try {
    file.create({ overwrite: true });
  } catch {
    // create() throws if the file already exists — the unique name makes this
    // effectively impossible, but never let it block the write.
  }
  file.write(pcm);
  return file;
}

/**
 * React hook that drives recording on the current platform and yields a raw-PCM
 * file on stop. Instantiate inside the sheet (mounted only while open) so the
 * recorder is released on close.
 */
export function useVoiceRecorder(): VoiceRecorderApi {
  const isIOS = Platform.OS === 'ios';
  const recorder = useAudioRecorder(IOS_LPCM_OPTIONS);
  const recState = useAudioRecorderState(recorder, 100);

  const [isRecording, setIsRecording] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [level, setLevel] = useState(0);

  const startedAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // react-native-audio-record default export, lazily loaded on Android only.
  const androidRecRef = useRef<import('react-native-audio-record').AudioRecordStatic | null>(null);

  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // iOS: mirror the polled recorder state (duration + metering) into our unified
  // reactive values while recording.
  useEffect(() => {
    if (!isIOS || !isRecording) return;
    setDurationMs(recState.durationMillis ?? 0);
    if (typeof recState.metering === 'number') {
      setLevel(clamp01((recState.metering + METERING_FLOOR_DB) / METERING_FLOOR_DB));
    }
  }, [isIOS, isRecording, recState.durationMillis, recState.metering]);

  const start = useCallback(async () => {
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      throw new VoicePermissionError(perm.canAskAgain);
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    startedAtRef.current = Date.now();
    setDurationMs(0);
    setLevel(0);

    if (isIOS) {
      await recorder.prepareToRecordAsync(IOS_LPCM_OPTIONS);
      recorder.record();
    } else {
      const mod = await import('react-native-audio-record');
      const AudioRecord = mod.default;
      AudioRecord.init({
        sampleRate: VOICE_SAMPLE_RATE,
        channels: 1,
        bitsPerSample: 16,
        audioSource: 6, // MediaRecorder.AudioSource.VOICE_RECOGNITION
        wavFile: `autexa-voice-${Date.now()}.wav`,
      });
      AudioRecord.start();
      androidRecRef.current = AudioRecord;
      // Android has no cheap metering — drive the waveform with a gentle
      // synthetic pulse and tick the timer ourselves.
      clearTimer();
      timerRef.current = setInterval(() => {
        const ms = Date.now() - startedAtRef.current;
        setDurationMs(ms);
        setLevel(0.35 + 0.4 * Math.abs(Math.sin(ms / 170)));
      }, 100);
    }
    setIsRecording(true);
  }, [isIOS, recorder]);

  const finishAndroid = useCallback(async (): Promise<string | null> => {
    const AudioRecord = androidRecRef.current;
    androidRecRef.current = null;
    if (!AudioRecord) return null;
    const path = await AudioRecord.stop();
    if (!path) return null;
    return path.startsWith('file://') ? path : `file://${path}`;
  }, []);

  const stop = useCallback(async (): Promise<VoicePcmResult | null> => {
    if (!isRecording) return null;
    setIsRecording(false);
    clearTimer();
    const durationSeconds = Math.min(VOICE_MAX_DURATION_SEC, Math.max(0, (Date.now() - startedAtRef.current) / 1000));

    let wavUri: string | null = null;
    try {
      if (isIOS) {
        await recorder.stop();
        wavUri = recorder.uri;
      } else {
        wavUri = await finishAndroid();
      }
    } finally {
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    }

    if (!wavUri) return null;
    const pcm = await wavUriToPcm(wavUri);
    if (!pcm || pcm.byteLength < MIN_PCM_BYTES) return null;

    const file = writePcmTempFile(pcm);
    return {
      uri: file.uri,
      name: 'audio.pcm',
      type: 'application/octet-stream',
      durationSeconds,
      sampleRate: VOICE_SAMPLE_RATE,
      byteLength: pcm.byteLength,
      cleanup: () => {
        try {
          file.delete();
        } catch {
          // temp file lives in the cache dir — the OS reclaims it anyway.
        }
      },
    };
  }, [isIOS, isRecording, recorder, finishAndroid]);

  const cancel = useCallback(async () => {
    clearTimer();
    try {
      if (isIOS) {
        if (recorder.isRecording) await recorder.stop();
      } else {
        await finishAndroid();
      }
    } catch {
      // best-effort teardown
    }
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    setIsRecording(false);
    setDurationMs(0);
    setLevel(0);
  }, [isIOS, recorder, finishAndroid]);

  // Never leave the mic hot if the sheet unmounts mid-recording.
  useEffect(() => {
    return () => {
      clearTimer();
      if (androidRecRef.current) {
        androidRecRef.current.stop().catch(() => {});
        androidRecRef.current = null;
      }
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, []);

  return { isRecording, durationMs, level, start, stop, cancel };
}

// ─── Error mapping ───────────────────────────────────────────────────────────

export type VoiceErrorKind = 'quota' | 'forbidden' | 'unconfigured' | 'network';

export interface VoiceError {
  kind: VoiceErrorKind;
  message: string;
}

/**
 * Map a /voice/transcribe failure to a user-facing message. Contract codes come
 * from the backend (402 VOICE_QUOTA_EXCEEDED / 403 VOICE_FEATURE_NOT_IN_PLAN /
 * 503 VOICE_NOT_CONFIGURED); everything else (network, timeout, 5xx, STT reject)
 * degrades to the generic "type it by hand" message — voice is an accelerator.
 */
export function mapVoiceError(err: unknown): VoiceError {
  const e = err as { response?: { status?: number; data?: { code?: string } } };
  const status = e?.response?.status;
  const code = e?.response?.data?.code;

  if (status === 402 || code === 'VOICE_QUOTA_EXCEEDED') {
    return {
      kind: 'quota',
      message: 'Закончились минуты голосового ввода. Обратитесь к владельцу сервиса.',
    };
  }
  if (status === 403 || code === 'VOICE_FEATURE_NOT_IN_PLAN') {
    return { kind: 'forbidden', message: 'Голосовой ввод не входит в ваш тариф.' };
  }
  if (status === 503 || code === 'VOICE_NOT_CONFIGURED') {
    return { kind: 'unconfigured', message: 'Голосовой ввод временно недоступен.' };
  }
  return {
    kind: 'network',
    message: 'Не удалось распознать, попробуйте ещё раз или введите вручную.',
  };
}
