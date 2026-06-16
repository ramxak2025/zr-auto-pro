/**
 * videoUrl — pure helpers to recognise and normalise YouTube / VK video links.
 *
 * Dependency-free, side-effect-free, Android-safe. Used by:
 *   • KnowledgeEditorScreen — validate the «Ссылка на видео» field before
 *     turning it into a `type: 'video'` attachment.
 *   • VideoEmbed — derive a poster thumbnail and a canonical watch URL.
 *
 * We deliberately do NOT depend on `react-native-webview` here (it isn't a
 * project dependency) — the renderer opens the canonical URL via Linking. If
 * WebView is ever added, `embedUrl()` already returns a ready iframe src.
 */
import type { KnowledgeAttachment } from '../../../../shared/types';

export type VideoProvider = NonNullable<KnowledgeAttachment['videoType']>;

export interface ParsedVideo {
  /** 'youtube' | 'vk' | 'embed' (generic fallback). */
  provider: VideoProvider;
  /** The original (canonical, watch) URL — what we hand to Linking.openURL. */
  url: string;
  /** Provider video id when extractable (YouTube id / VK "oid_vid"). */
  id?: string;
}

const YT_HOSTS = ['youtube.com', 'youtu.be', 'm.youtube.com', 'www.youtube.com'];
const VK_HOSTS = ['vk.com', 'm.vk.com', 'vkvideo.ru', 'www.vk.com', 'vk.ru'];

/** Normalise a user-typed string to an absolute https URL we can parse. */
export function normalizeVideoUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function hostMatches(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((d) => h === d || h.endsWith(`.${d}`));
}

/**
 * Parse a YouTube / VK (or generic) video link. Returns null when the string is
 * not a plausible http(s) URL at all — the editor uses null to reject input.
 */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  const url = normalizeVideoUrl(raw);
  if (!url) return null;

  // RN's URL is sufficient for host/path/query extraction.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname.includes('.')) return null;

  const host = parsed.hostname.toLowerCase();

  // ── YouTube ──────────────────────────────────────────────────────────────
  if (hostMatches(host, YT_HOSTS)) {
    let id: string | undefined;
    if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
      id = parsed.pathname.split('/').filter(Boolean)[0];
    } else if (parsed.pathname.startsWith('/shorts/') || parsed.pathname.startsWith('/embed/')) {
      id = parsed.pathname.split('/').filter(Boolean)[1];
    } else {
      id = parsed.searchParams.get('v') ?? undefined;
    }
    return { provider: 'youtube', url, id: id || undefined };
  }

  // ── VK Видео ───────────────────────────────────────────────────────────────
  if (hostMatches(host, VK_HOSTS)) {
    // vk.com/video-123_456  |  vkvideo.ru/video123_456  |  ?z=video-1_2
    const fromPath = parsed.pathname.match(/video(-?\d+_\d+)/i);
    const fromQuery = parsed.search.match(/video(-?\d+_\d+)/i);
    const id = (fromPath?.[1] ?? fromQuery?.[1]) || undefined;
    return { provider: 'vk', url, id };
  }

  // ── Anything else that's a valid http(s) link → generic embed/open ────────
  return { provider: 'embed', url };
}

/** YouTube poster thumbnail (hqdefault is always present). VK has no public one. */
export function videoThumbnail(parsed: ParsedVideo): string | null {
  if (parsed.provider === 'youtube' && parsed.id) {
    return `https://img.youtube.com/vi/${parsed.id}/hqdefault.jpg`;
  }
  return null;
}

/**
 * Canonical embeddable iframe src — used only if a WebView renderer is wired in
 * later. Falls back to the original URL for the generic provider.
 */
export function embedUrl(parsed: ParsedVideo): string {
  if (parsed.provider === 'youtube' && parsed.id) {
    return `https://www.youtube.com/embed/${parsed.id}`;
  }
  if (parsed.provider === 'vk' && parsed.id) {
    const [oid, vid] = parsed.id.split('_');
    return `https://vk.com/video_ext.php?oid=${oid}&id=${vid}&hd=2`;
  }
  return parsed.url;
}

/** Human label for the provider, for UI. */
export function videoProviderLabel(provider: VideoProvider): string {
  switch (provider) {
    case 'youtube':
      return 'YouTube';
    case 'vk':
      return 'VK Видео';
    default:
      return 'Видео';
  }
}
