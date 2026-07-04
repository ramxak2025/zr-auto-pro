/**
 * Pure WAV → raw-PCM helpers for the voice-comment feature.
 *
 * WHY raw PCM (headerless): the backend voice adapter (backend/src/voice/
 * yandex-stt.adapter.ts) forwards the uploaded bytes to Yandex SpeechKit STT v1
 * **as-is** (no ffmpeg on the server) with `format=lpcm`. Yandex `lpcm` means
 * signed 16-bit little-endian PCM WITHOUT any container header. Every recorder
 * we use writes a `.wav` (RIFF/WAVE) file with a 44-byte-ish header, so we must
 * strip the header to the `data` chunk before upload — otherwise the RIFF bytes
 * would be interpreted as (garbage) audio samples.
 *
 * No React Native / native imports here on purpose — this stays unit-testable
 * under plain jest (see __tests__/wavPcm.test.ts).
 */

/**
 * Extract the raw PCM sample bytes from a WAV (RIFF/WAVE) byte buffer.
 *
 * Walks the RIFF chunk list to find the `data` chunk (robust to any extra
 * `LIST`/`fact`/`fllr` chunks a recorder might emit before `data`). If the
 * buffer is not a RIFF/WAVE container it is assumed to already be raw PCM and
 * returned unchanged.
 */
export function extractPcmFromWav(bytes: Uint8Array): Uint8Array {
  // 'RIFF' magic (0x52 0x49 0x46 0x46). Not present → treat as already-raw PCM.
  if (bytes.length < 44 || bytes[0] !== 0x52 || bytes[1] !== 0x49 || bytes[2] !== 0x46 || bytes[3] !== 0x46) {
    return bytes;
  }
  // 'WAVE' at offset 8. Not present → not a WAV we understand; return as-is.
  if (bytes[8] !== 0x57 || bytes[9] !== 0x41 || bytes[10] !== 0x56 || bytes[11] !== 0x45) {
    return bytes;
  }

  const readU32LE = (o: number): number =>
    (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;

  // Chunk list starts right after the 12-byte RIFF/WAVE header.
  let off = 12;
  while (off + 8 <= bytes.length) {
    const isData = bytes[off] === 0x64 && bytes[off + 1] === 0x61 && bytes[off + 2] === 0x74 && bytes[off + 3] === 0x61; // 'data'
    const size = readU32LE(off + 4);
    const dataStart = off + 8;
    if (isData) {
      const end = Math.min(dataStart + size, bytes.length);
      return bytes.subarray(dataStart, end);
    }
    // Chunks are word-aligned: a body of odd length is followed by a pad byte.
    off = dataStart + size + (size & 1);
  }

  // No `data` chunk found (should not happen for a valid PCM WAV) — fall back to
  // dropping the canonical 44-byte header rather than sending the RIFF header.
  return bytes.subarray(44);
}
