/**
 * KnowledgeBlocks — the block-based article renderer for the Knowledge Base
 * reader.
 *
 * Renders an ordered `KnowledgeBlock[]` (079 contract) so the reader screen
 * stays clean. Block kinds:
 *   • text    → styled body paragraph(s) (blank-line separated).
 *   • heading → section title (level 2 → title2, level 3 → title3, default 2).
 *   • image   → inline 16:9-ish image + optional caption; tap → fullscreen
 *               preview (same BlurView modal UX as ProductDetail/Warehouse).
 *   • video   → VK-only in-app player: a 16:9 WebView pointed at the VK
 *               `video_ext.php` embed URL converted from the stored share link.
 *               Caption below.
 *
 * VK url → embed:
 *   The owner stores a share link (vk.com/video-123_456, vkvideo.ru/...,
 *   vk.ru/...). We extract the owner id (`oid`, may be negative for groups)
 *   and the video id (`vid`) and build
 *     https://vk.com/video_ext.php?oid=<oid>&id=<vid>&hd=2
 *   If the link is unparseable, the block degrades to an «Открыть в VK» link.
 *
 * react-native-webview is linked only at the NEXT native prebuild/rebuild
 * (batched). Until then `require` may resolve the JS but the native view isn't
 * registered — so each player is wrapped in a tiny error boundary that falls
 * back to the «Открыть в VK» link instead of crashing the whole reader. This is
 * expected: VK video plays inline only after the native rebuild ships.
 *
 * Android-safe: WebView works on both platforms; the fullscreen preview
 * degrades through expo-blur the same way the rest of the app does.
 */
import React from 'react';
import { Linking, Modal as RNModal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
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

// ── Lazy WebView (native linked only after the batched prebuild) ─────────────
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
            const paragraphs = block.text.replace(/\r\n/g, '\n').split(/\n{2,}/);
            return (
              <View key={i} style={styles.textBlock}>
                {paragraphs.map((para, p) => (
                  <Text key={p} variant="body" style={[styles.paragraph, { color: palette.text.secondary }]}>
                    {para.trim()}
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
            return (
              <View key={i} style={styles.mediaBlock}>
                <Pressable
                  onPress={() => {
                    haptic('tap');
                    setPreview(uri);
                  }}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={block.caption || 'Открыть изображение'}
                >
                  <CachedImage
                    source={{ uri }}
                    style={[styles.image, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                    resizeMode="cover"
                  />
                </Pressable>
                {block.caption ? (
                  <Text variant="footnote" style={[styles.caption, { color: palette.text.tertiary }]}>
                    {block.caption}
                  </Text>
                ) : null}
              </View>
            );
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
                      style={[styles.player, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                    >
                      <WebViewComponent
                        source={{ uri: embed }}
                        style={styles.webview}
                        allowsInlineMediaPlayback
                        mediaPlaybackRequiresUserAction
                        allowsFullscreenVideo
                        javaScriptEnabled
                        domStorageEnabled
                        // Keep a static empty start to avoid a white flash on iOS.
                        originWhitelist={['https://*']}
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
  root: { gap: spacing[3] },

  textBlock: { gap: spacing[2] },
  paragraph: { lineHeight: 23 },

  heading2: { marginTop: spacing[2] },
  heading3: { marginTop: spacing[1] },

  mediaBlock: { gap: spacing[1.5] },
  image: {
    width: '100%',
    height: 220,
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  caption: { textAlign: 'center', paddingHorizontal: spacing[2] },

  player: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: borderRadius.xl,
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
