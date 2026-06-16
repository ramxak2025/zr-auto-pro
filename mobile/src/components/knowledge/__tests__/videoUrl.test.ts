/**
 * videoUrl tests — `src/components/knowledge/videoUrl.ts`.
 *
 * This parser is load-bearing: it both (a) validates the «Ссылка на видео»
 * field in KnowledgeEditorScreen before an attachment is created, and (b)
 * drives VideoEmbed's provider/thumbnail/open-URL behaviour. A regression here
 * means broken video links saved into article attachments — so we pin the
 * recognised YouTube/VK shapes and the rejection of non-URLs.
 */
import { parseVideoUrl, normalizeVideoUrl, videoThumbnail, embedUrl, videoProviderLabel } from '../videoUrl';

describe('normalizeVideoUrl', () => {
  it('keeps absolute http(s) URLs', () => {
    expect(normalizeVideoUrl('https://youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(normalizeVideoUrl('http://vk.com/video-1_2')).toBe('http://vk.com/video-1_2');
  });
  it('prefixes bare hosts with https://', () => {
    expect(normalizeVideoUrl('youtu.be/abc')).toBe('https://youtu.be/abc');
    expect(normalizeVideoUrl('  vk.com/video1_2  ')).toBe('https://vk.com/video1_2');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeVideoUrl('   ')).toBe('');
  });
});

describe('parseVideoUrl — YouTube', () => {
  it('parses watch?v=', () => {
    const p = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s');
    expect(p?.provider).toBe('youtube');
    expect(p?.id).toBe('dQw4w9WgXcQ');
  });
  it('parses youtu.be short link', () => {
    const p = parseVideoUrl('https://youtu.be/dQw4w9WgXcQ');
    expect(p?.provider).toBe('youtube');
    expect(p?.id).toBe('dQw4w9WgXcQ');
  });
  it('parses /shorts/ and /embed/', () => {
    expect(parseVideoUrl('https://www.youtube.com/shorts/abc123')?.id).toBe('abc123');
    expect(parseVideoUrl('https://www.youtube.com/embed/abc123')?.id).toBe('abc123');
  });
  it('parses bare youtube link without scheme', () => {
    const p = parseVideoUrl('youtube.com/watch?v=xyz');
    expect(p?.provider).toBe('youtube');
    expect(p?.id).toBe('xyz');
  });
});

describe('parseVideoUrl — VK', () => {
  it('parses vk.com/video path with negative oid', () => {
    const p = parseVideoUrl('https://vk.com/video-12345_67890');
    expect(p?.provider).toBe('vk');
    expect(p?.id).toBe('-12345_67890');
  });
  it('parses vkvideo.ru', () => {
    const p = parseVideoUrl('https://vkvideo.ru/video123_456');
    expect(p?.provider).toBe('vk');
    expect(p?.id).toBe('123_456');
  });
  it('parses ?z=video query form', () => {
    const p = parseVideoUrl('https://vk.com/feed?z=video-1_2');
    expect(p?.provider).toBe('vk');
    expect(p?.id).toBe('-1_2');
  });
});

describe('parseVideoUrl — generic & rejection', () => {
  it('treats any other valid http(s) URL as generic embed', () => {
    const p = parseVideoUrl('https://example.com/clip.mp4');
    expect(p?.provider).toBe('embed');
    expect(p?.id).toBeUndefined();
  });
  it('rejects non-URL garbage (no dot in host)', () => {
    expect(parseVideoUrl('hello world')).toBeNull();
    expect(parseVideoUrl('justtext')).toBeNull();
  });
  it('rejects empty input', () => {
    expect(parseVideoUrl('')).toBeNull();
    expect(parseVideoUrl('   ')).toBeNull();
  });
});

describe('videoThumbnail', () => {
  it('returns a YouTube poster for youtube with id', () => {
    const p = parseVideoUrl('https://youtu.be/abc')!;
    expect(videoThumbnail(p)).toBe('https://img.youtube.com/vi/abc/hqdefault.jpg');
  });
  it('returns null for VK / generic', () => {
    expect(videoThumbnail(parseVideoUrl('https://vk.com/video1_2')!)).toBeNull();
    expect(videoThumbnail(parseVideoUrl('https://example.com/x')!)).toBeNull();
  });
});

describe('embedUrl', () => {
  it('builds a youtube embed src', () => {
    expect(embedUrl(parseVideoUrl('https://youtu.be/abc')!)).toBe('https://www.youtube.com/embed/abc');
  });
  it('builds a vk video_ext src', () => {
    expect(embedUrl(parseVideoUrl('https://vk.com/video-1_2')!)).toBe('https://vk.com/video_ext.php?oid=-1&id=2&hd=2');
  });
  it('falls back to the original URL for generic', () => {
    expect(embedUrl(parseVideoUrl('https://example.com/x')!)).toBe('https://example.com/x');
  });
});

describe('videoProviderLabel', () => {
  it('labels each provider', () => {
    expect(videoProviderLabel('youtube')).toBe('YouTube');
    expect(videoProviderLabel('vk')).toBe('VK Видео');
    expect(videoProviderLabel('embed')).toBe('Видео');
  });
});
