/**
 * VideoEmbed — inline video card for Knowledge Base articles (YouTube / VK).
 *
 * WHY a preview card and NOT an inline player:
 *   `react-native-webview` is NOT a project dependency, and the contract for
 *   this feature is explicit: do NOT add a native dependency. So instead of an
 *   in-app iframe we render a polished, full-width 16:9 poster card with a play
 *   button that opens the video in the system handler via `Linking.openURL`
 *   (YouTube/VK app if installed, else the browser).
 *
 *   The component is forward-compatible: `videoUrl.ts` already exposes
 *   `embedUrl()`, so if WebView is ever added this card can be swapped for a
 *   real iframe without touching callers.
 *
 * Behaviour:
 *   • YouTube → shows the real poster thumbnail (img.youtube.com).
 *   • VK / generic → branded gradient-free solid poster with the play glyph.
 *   • Tap anywhere → haptic + open the canonical watch URL.
 *
 * Android-safe: only Linking + RN primitives + CachedImage (already used app-wide).
 */
import React from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CachedImage from '../CachedImage';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { haptic } from '../../platform/haptics';
import { parseVideoUrl, videoThumbnail, videoProviderLabel } from './videoUrl';
import type { KnowledgeAttachment } from '../../../../shared/types';

interface VideoEmbedProps {
  /** The video attachment (type === 'video'). */
  attachment: KnowledgeAttachment;
}

function VideoEmbedInner({ attachment }: VideoEmbedProps) {
  const palette = useColors();

  const parsed = React.useMemo(() => parseVideoUrl(attachment.url), [attachment.url]);
  // videoType from the contract wins over heuristic detection when present.
  const provider = attachment.videoType ?? parsed?.provider ?? 'embed';
  const thumb = React.useMemo(() => (parsed ? videoThumbnail(parsed) : null), [parsed]);
  const providerLabel = videoProviderLabel(provider);

  const open = React.useCallback(() => {
    haptic('tap');
    const url = parsed?.url ?? attachment.url;
    if (url) Linking.openURL(url).catch(() => {});
  }, [parsed, attachment.url]);

  return (
    <Pressable
      onPress={open}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`Открыть видео${attachment.name ? `: ${attachment.name}` : ''}`}
    >
      {/* 16:9 poster */}
      <View style={[styles.poster, { backgroundColor: palette.bg.muted }]}>
        {thumb ? <CachedImage source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
        {/* Scrim so the play button reads on any thumbnail. */}
        <View style={styles.scrim} />
        <View style={styles.playWrap}>
          <View style={styles.playBtn}>
            <Ionicons name="play" size={26} color={colors.white} style={{ marginLeft: 3 }} />
          </View>
        </View>
        {/* Provider badge */}
        <View style={styles.badge}>
          <Ionicons name={provider === 'youtube' ? 'logo-youtube' : 'videocam'} size={13} color={colors.white} />
          <Text variant="caption" style={{ color: colors.white, fontWeight: '700' }}>
            {providerLabel}
          </Text>
        </View>
      </View>

      {/* Caption row */}
      <View style={styles.captionRow}>
        <Text variant="footnote" numberOfLines={1} style={{ flex: 1, color: palette.text.secondary }}>
          {attachment.name?.trim() || 'Открыть видео'}
        </Text>
        <Ionicons name="open-outline" size={16} color={palette.text.tertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing[1.5] },
  poster: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.18)' },
  playWrap: { alignItems: 'center', justifyContent: 'center' },
  playBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: spacing[2],
    left: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },
  captionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[0.5] },
});

export const VideoEmbed = React.memo(VideoEmbedInner);
export default VideoEmbed;
