// ───────────────────────────────────────────────────────────────────────
//  VK video URL → embed (player) URL parsing for Knowledge Base video blocks.
//
//  A stored video block keeps a plain VK link (`provider: 'vk'`, e.g.
//  `https://vk.com/video-123456_789012`). To embed it in an <iframe> VK
//  expects the player form `https://vk.com/video_ext.php?oid=<oid>&id=<id>`.
//  The server validates the host (VK whitelist) on save; this is the
//  client-side reader/preview parser.
// ───────────────────────────────────────────────────────────────────────

/**
 * Parse any reasonable VK video link into the iframe player URL.
 *
 * Handles:
 *   - `https://vk.com/video-123_456`        (group owner — negative oid)
 *   - `https://vk.com/video123_456`         (user owner — positive oid)
 *   - `https://vkvideo.ru/video-123_456`    (new VK Video domain)
 *   - `https://m.vk.com/clip-123_456`       (clips)
 *   - already-built `…/video_ext.php?oid=…&id=…&hash=…` (normalized, passed through)
 *
 * Returns the `https://vk.com/video_ext.php?…` URL, or `null` when the input
 * is not a recognizable VK video link.
 */
export function parseVkEmbedUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const url = raw.trim();
  if (!url) return null;

  // Already a player URL — keep its query, just force the canonical https host.
  const ext = url.match(/video_ext\.php\?([^#\s]+)/i);
  if (ext) {
    return `https://vk.com/video_ext.php?${ext[1]}`;
  }

  // `video<oid>_<id>` / `clip<oid>_<id>` — oid may be negative (groups).
  const m = url.match(/(?:video|clip)(-?\d+)_(\d+)/i);
  if (!m) return null;

  const oid = m[1];
  const id = m[2];
  // Some private/unlisted videos require the `hash` access token from the link.
  const hashMatch = url.match(/[?&]hash=([0-9a-zA-Z]+)/);
  const hash = hashMatch ? `&hash=${hashMatch[1]}` : '';

  return `https://vk.com/video_ext.php?oid=${oid}&id=${id}${hash}&hd=2`;
}

/** True when the string looks like a VK link we can embed. */
export function isParseableVkUrl(raw: string | undefined | null): boolean {
  return parseVkEmbedUrl(raw) !== null;
}
