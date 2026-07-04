import { extractPcmFromWav } from '../wavPcm';

/** Build a minimal PCM WAV (RIFF/WAVE + fmt + optional extra chunks + data). */
function buildWav(pcm: Uint8Array, extraChunks: { id: string; body: Uint8Array }[] = []): Uint8Array {
  const enc = (s: string) => Uint8Array.from(s.split('').map((c) => c.charCodeAt(0)));
  const u32 = (n: number) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
  const u16 = (n: number) => Uint8Array.from([n & 0xff, (n >>> 8) & 0xff]);

  const fmtBody = new Uint8Array([
    ...u16(1), // PCM
    ...u16(1), // mono
    ...u32(16000), // sample rate
    ...u32(32000), // byte rate
    ...u16(2), // block align
    ...u16(16), // bits per sample
  ]);

  const chunk = (id: string, body: Uint8Array) => {
    const pad = body.length & 1 ? new Uint8Array([0]) : new Uint8Array(0);
    return new Uint8Array([...enc(id), ...u32(body.length), ...body, ...pad]);
  };

  const chunks = [chunk('fmt ', fmtBody), ...extraChunks.map((c) => chunk(c.id, c.body)), chunk('data', pcm)];
  const bodyLen = chunks.reduce((n, c) => n + c.length, 0) + 4; // + 'WAVE'
  return new Uint8Array([...enc('RIFF'), ...u32(bodyLen), ...enc('WAVE'), ...chunks.flatMap((c) => Array.from(c))]);
}

describe('extractPcmFromWav', () => {
  const pcm = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);

  it('extracts the data chunk from a canonical PCM WAV', () => {
    const out = extractPcmFromWav(buildWav(pcm));
    expect(Array.from(out)).toEqual(Array.from(pcm));
  });

  it('finds data even when other chunks (LIST) precede it', () => {
    const out = extractPcmFromWav(buildWav(pcm, [{ id: 'LIST', body: Uint8Array.from([9, 9, 9, 9]) }]));
    expect(Array.from(out)).toEqual(Array.from(pcm));
  });

  it('handles a preceding odd-length chunk (word alignment)', () => {
    // 3-byte body forces a pad byte; the walker must skip it to land on data.
    const out = extractPcmFromWav(buildWav(pcm, [{ id: 'fllr', body: Uint8Array.from([7, 7, 7]) }]));
    expect(Array.from(out)).toEqual(Array.from(pcm));
  });

  it('does not read past the buffer when the data size is truncated', () => {
    const wav = buildWav(pcm);
    const truncated = wav.subarray(0, wav.length - 3); // lose 3 sample bytes
    const out = extractPcmFromWav(truncated);
    expect(out.length).toBe(pcm.length - 3);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns non-RIFF input unchanged (already raw PCM)', () => {
    const raw = Uint8Array.from([10, 20, 30, 40, 50]);
    expect(extractPcmFromWav(raw)).toBe(raw);
  });

  it('produces an even number of bytes for 16-bit mono audio', () => {
    const out = extractPcmFromWav(buildWav(pcm));
    expect(out.length % 2).toBe(0);
  });
});
