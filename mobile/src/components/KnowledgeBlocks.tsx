/**
 * KnowledgeBlocks — the block-based article renderer for the Knowledge Base
 * reader.
 *
 * Goal: reading an article must feel like a real magazine / website article
 * rendered INSIDE the app — interleaved blocks in their authored order:
 *   текст → фото (видно сразу, инлайн) → текст → видео (играет в приложении) → …
 *
 * Block kinds:
 *   • text    → article-grade paragraphs: 17pt, 1.6 line-height, primary ink,
 *               blank-line separated, comfortable paragraph rhythm.
 *   • heading → section title (level 2 → 22pt, level 3 → 18pt) with generous
 *               top breathing room, so long reads keep a clear hierarchy.
 *   • image   → full-width, ROUNDED, shown at its NATURAL aspect ratio (no
 *               fixed-height crop) the moment its size is known; tap →
 *               fullscreen preview (same BlurView modal UX as Warehouse).
 *               Optional centred caption.
 *   • video   → VK in-app player: a 16:9 WebView pointed at the VK
 *               `video_ext.php` embed URL. Plays inline — never jumps to an
 *               external browser. Caption below.
 *
 * VK url → embed:
 *   The owner stores a share link (vk.com/video-123_456, vkvideo.ru/...,
 *   vk.ru/...). We extract the owner id (`oid`, may be negative for groups)
 *   and the video id (`vid`) and build
 *     https://vk.com/video_ext.php?oid=<oid>&id=<vid>&hd=2
 *   If the link is unparseable, the block degrades to an «Открыть в VK» link.
 *
 * react-native-webview is a project dependency; it renders the native view
 * after a prebuild/rebuild. Until then `require` may resolve the JS but the
 * native view isn't registered — so each player is wrapped in a tiny error
 * boundary that falls back to the «Открыть в VK» link instead of crashing the
 * whole reader.
 *
 * Android-safe: WebView works on both platforms; the fullscreen preview
 * degrades through expo-blur the same way the rest of the app does.
 */
import React from 'react';
import { Linking, Modal as RNModal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import type { ImageLoadEventData } from 'expo-image';
import CachedImage from './CachedImage';
import { Text } from '../platform/Typography';
import { spacing, borderRadius, colors } from '../theme';
import { useColors } from '../contexts/ThemeContext';
import { getImageUrl } from '../api/axios';
import { haptic } from '../platform/haptics';
import type { KnowledgeBlock } from '../../../shared/types';
import type { WebViewProps } from 'react-native-webview';

// ── VK share-url → embed-url ────────────────────────────────────────────────

/**
 * Convert a VK video share/link URL into the embeddable `video_ext.php` player
 * URL. Returns null when neither an explicit oid/id pair nor a `video<oid>_<vid>`
 * token can be found — the caller then shows an «Открыть в VK» fallback.
 *
 * Handles:
 *   • vk.com/video-123_456        (group owner — negative oid)
 *   • vkvideo.ru/video123_456     (user owner — positive oid)
 *   • vk.ru/video-123_456
 *   • …?z=video-1_2               (id in the query)
 *   • …/video_ext.php?oid=-1&id=2 (already an embed link)
 */
export function vkEmbedUrl(rawUrl: string): string | null {
  const url = (rawUrl ?? '').trim();
  if (!url) return null;

  let oid: string | undefined;
  let vid: string | undefined;

  // 1) Explicit oid/id params (e.g. an already-built video_ext.php link).
  const oidParam = url.match(/[?&]oid=(-?\d+)/i);
  const idParam = url.match(/[?&]id=(\d+)/i);
  if (oidParam && idParam) {
    oid = oidParam[1];
    vid = idParam[1];
  } else {
    // 2) Share form: video<oid>_<vid> in the path or query (oid may be negative).
    const token = url.match(/video(-?\d+)_(\d+)/i);
    if (token) {
      oid = token[1];
      vid = token[2];
    }
  }

  if (!oid || !vid) return null;
  return `https://vk.com/video_ext.php?oid=${oid}&id=${vid}&hd=2`;
}

// ── Lazy WebView (native linked after the batched prebuild) ──────────────────
let WebViewComponent: React.ComponentType<WebViewProps> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebViewComponent = require('react-native-webview').WebView ?? null;
} catch {
  WebViewComponent = null;
}

/** Catches the "RNCWebView not found" render error before the native rebuild. */
class WebViewBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Default aspect before an image's natural size is known — a gentle landscape
// so the placeholder reserves a believable amount of height (no jump-shrink).
const DEFAULT_IMAGE_ASPECT = 16 / 10;
// Clamp natural aspect so a panorama or a tall screenshot still reads well in a
// phone-width column instead of dominating the whole viewport.
const MIN_IMAGE_ASPECT = 0.66; // tall (portrait) cap
const MAX_IMAGE_ASPECT = 1.9; // wide (landscape) cap

/**
 * ArticleImage — full-width inline photo shown at its NATURAL aspect ratio.
 *
 * We start at a believable landscape placeholder and, the moment expo-image
 * reports the bitmap's real dimensions, switch to the true (clamped) ratio so
 * nothing is cropped — a magazine-grade presentation. Tap → fullscreen.
 */
function ArticleImage({
  uri,
  caption,
  onPreview,
}: {
  uri: string;
  caption?: string;
  onPreview: (uri: string) => void;
}) {
  const palette = useColors();
  const [aspect, setAspect] = React.useState<number>(DEFAULT_IMAGE_ASPECT);

  const onLoad = React.useCallback((e: ImageLoadEventData) => {
    const w = e?.source?.width;
    const h = e?.source?.height;
    if (w && h && h > 0) {
      const r = w / h;
      setAspect(Math.max(MIN_IMAGE_ASPECT, Math.min(MAX_IMAGE_ASPECT, r)));
    }
  }, []);

  return (
    <View style={styles.mediaBlock}>
      <Pressable
        onPress={() => {
          haptic('tap');
          onPreview(uri);
        }}
        accessibilityRole="imagebutton"
        accessibilityLabel={caption || 'Открыть изображение'}
      >
        <CachedImage
          source={{ uri }}
          style={[
            styles.image,
            { aspectRatio: aspect, backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
          ]}
          resizeMode="cover"
          onLoad={onLoad}
        />
      </Pressable>
      {caption ? (
        <Text variant="footnote" style={[styles.caption, { color: palette.text.tertiary }]}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

// ── Component ────────────────────────────────────────────────────────────────
interface KnowledgeBlocksProps {
  blocks: KnowledgeBlock[];
}

function KnowledgeBlocksInner({ blocks }: KnowledgeBlocksProps) {
  const palette = useColors();
  const [preview, setPreview] = React.useState<string | null>(null);

  const openVk = React.useCallback((url: string) => {
    haptic('tap');
    Linking.openURL(url).catch(() => {});
  }, []);

  return (
    <View style={styles.root}>
      {blocks.map((block, i) => {
        switch (block.type) {
          // ── Text ────────────────────────────────────────────────────────
          case 'text': {
            const paragraphs = block.text
              .replace(/\r\n/g, '\n')
              .split(/\n{2,}/)
              .map((p) => p.trim())
              .filter(Boolean);
            if (paragraphs.length === 0) return null;
            return (
              <View key={i} style={styles.textBlock}>
                {paragraphs.map((para, p) => (
                  <Text key={p} variant="body" style={[styles.paragraph, { color: palette.text.primary }]}>
                    {para}
                  </Text>
                ))}
              </View>
            );
          }

          // ── Heading ─────────────────────────────────────────────────────
          case 'heading': {
            const level = block.level ?? 2;
            return (
              <Text
                key={i}
                variant={level === 3 ? 'title3' : 'title2'}
                color={palette.text.primary}
                style={level === 3 ? styles.heading3 : styles.heading2}
              >
                {block.text}
              </Text>
            );
          }

          // ── Image ───────────────────────────────────────────────────────
          case 'image': {
            const uri = getImageUrl(block.url);
            if (!uri) return null;
            return <ArticleImage key={i} uri={uri} caption={block.caption} onPreview={setPreview} />;
          }

          // ── Video (VK) ──────────────────────────────────────────────────
          case 'video': {
            const embed = vkEmbedUrl(block.url);
            const fallback = (
              <Pressable
                onPress={() => openVk(block.url)}
                style={({ pressed }) => [
                  styles.vkFallback,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.7 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="Открыть видео в VK"
              >
                <View style={[styles.vkIcon, { backgroundColor: palette.accent.primarySoft }]}>
                  <Ionicons name="logo-vk" size={20} color={palette.accent.primary} />
                </View>
                <Text variant="bodyEmph" style={{ flex: 1, color: palette.text.primary }}>
                  Открыть в VK
                </Text>
                <Ionicons name="open-outline" size={18} color={palette.text.tertiary} />
              </Pressable>
            );

            return (
              <View key={i} style={styles.mediaBlock}>
                {embed && WebViewComponent ? (
                  <WebViewBoundary fallback={fallback}>
                    <View
                      style={[styles.player, { backgroundColor: colors.black, borderColor: palette.border.subtle }]}
                    >
                      <WebViewComponent
                        source={{ uri: embed }}
                        style={styles.webview}
                        allowsInlineMediaPlayback
                        mediaPlaybackRequiresUserAction
                        allowsFullscreenVideo
                        javaScriptEnabled
                        domStorageEnabled
                        // Keep the player INSIDE the app: allow any http(s)
                        // navigation to load IN the WebView, but block custom
                        // schemes (e.g. `vk://`) that would hand off to the
                        // native VK app / external browser. Web navigations stay
                        // in-place — Android-safe (http/https always allowed).
                        originWhitelist={['https://*', 'http://*']}
                        onShouldStartLoadWithRequest={(req) =>
                          req.url.startsWith('https://') || req.url.startsWith('http://') || req.url === 'about:blank'
                        }
                      />
                    </View>
                  </WebViewBoundary>
                ) : (
                  fallback
                )}
                {block.caption ? (
                  <Text variant="footnote" style={[styles.caption, { color: palette.text.tertiary }]}>
                    {block.caption}
                  </Text>
                ) : null}
              </View>
            );
          }

          default:
            return null;
        }
      })}

      {/* Fullscreen image preview — mirrors the warehouse/product preview UX. */}
      <RNModal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.fullscreenOverlay} onPress={() => setPreview(null)}>
          <BlurView intensity={Platform.OS === 'android' ? 24 : 40} tint="dark" style={StyleSheet.absoluteFill} />
          {Platform.OS === 'android' && <View pointerEvents="none" style={styles.fullscreenScrim} />}
          {preview ? (
            <Pressable style={styles.fullscreenImageWrap} onPress={(e) => e.stopPropagation?.()}>
              <CachedImage source={{ uri: preview }} style={styles.fullscreenImage} resizeMode="contain" />
            </Pressable>
          ) : null}
          <Pressable
            style={styles.fullscreenClose}
            onPress={() => setPreview(null)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={20} color={colors.white} />
          </Pressable>
        </Pressable>
      </RNModal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Vertical rhythm between blocks. Headings/media add their own top margin on
  // top of this for a clear magazine cadence.
  root: { gap: spacing[4] },

  // Paragraph rhythm WITHIN a text block (slightly tighter than block gap).
  textBlock: { gap: spacing[3] },
  // Article-grade reading text: larger size + open line-height + primary ink.
  paragraph: { fontSize: 17, lineHeight: 27, letterSpacing: -0.2 },

  // Section headings — extra top breathing room separates them from the
  // paragraph above (on top of the root gap).
  heading2: { fontSize: 22, lineHeight: 28, letterSpacing: -0.3, marginTop: spacing[2] },
  heading3: { fontSize: 18, lineHeight: 24, letterSpacing: -0.2, marginTop: spacing[1.5] },

  mediaBlock: { gap: spacing[2] },
  image: {
    width: '100%',
    // height comes from aspectRatio (natural, clamped) — no fixed-height crop.
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  caption: { textAlign: 'center', paddingHorizontal: spacing[3], fontStyle: 'italic' },

  player: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  webview: { flex: 1, backgroundColor: 'transparent' },

  vkFallback: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  vkIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Fullscreen preview
  fullscreenOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  fullscreenScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  fullscreenImageWrap: {
    width: '92%',
    height: '74%',
    borderRadius: 24,
    overflow: 'hidden',
  },
  fullscreenImage: { width: '100%', height: '100%' },
  fullscreenClose: {
    position: 'absolute',
    top: 56,
    right: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export const KnowledgeBlocks = React.memo(KnowledgeBlocksInner);
export default KnowledgeBlocks;
