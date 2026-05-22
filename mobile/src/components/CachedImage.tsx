import React from 'react';
import { Image, ImageProps, ImageSource } from 'expo-image';
import type { StyleProp, ImageStyle } from 'react-native';

/**
 * Drop-in replacement for react-native `<Image>` that uses expo-image
 * under the hood with memory+disk caching, a gentle 200 ms fade-in,
 * and a tiny gray blurhash placeholder so users always see a
 * surface instead of empty white while the bitmap downloads.
 *
 * Why: native RN Image re-downloads on every render for remote URIs
 * and offers no persistent cache. expo-image serves cached data in
 * <1ms and persists across app launches — critical for screens that
 * show many product/avatar thumbnails.
 */
type LegacyImageProps = Omit<ImageProps, 'source' | 'style'> & {
  source: ImageSource | number | { uri?: string | null } | null | undefined;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
};

const RESIZE_MAP: Record<NonNullable<LegacyImageProps['resizeMode']>, ImageProps['contentFit']> = {
  cover: 'cover',
  contain: 'contain',
  stretch: 'fill',
  center: 'scale-down',
};

/**
 * Default blurhash — flat neutral gray. Decodes in <1 ms so we get a
 * visible surface for the 100-400 ms gap between mount and the first
 * bitmap frame. App-wide default; specific call-sites can override
 * via the `placeholder` prop (e.g. a category-coloured hash).
 *
 * Generated for `#e5e7eb` (Tailwind gray-200). 4-component hash —
 * lowest fidelity, smallest payload, perfectly fine for "shimmer" UX.
 */
const DEFAULT_BLURHASH = 'L4SY{q?b00?b~q?b?b?b?b?b?b?b';

const CachedImage = React.memo(function CachedImage({
  source,
  resizeMode = 'cover',
  style,
  placeholder,
  transition,
  ...rest
}: LegacyImageProps) {
  // Normalize `{ uri: null }` and falsy sources to undefined so expo-image
  // renders nothing instead of trying to fetch an empty string.
  const normalizedSource = React.useMemo(() => {
    if (!source) return undefined;
    if (typeof source === 'number') return source;
    if (typeof source === 'object' && 'uri' in source) {
      const uri = (source as { uri?: string | null }).uri;
      return uri ? { uri } : undefined;
    }
    return source as ImageSource;
  }, [source]);

  return (
    <Image
      source={normalizedSource}
      contentFit={RESIZE_MAP[resizeMode]}
      cachePolicy="memory-disk"
      transition={transition ?? 200}
      placeholder={placeholder ?? { blurhash: DEFAULT_BLURHASH }}
      placeholderContentFit={RESIZE_MAP[resizeMode]}
      style={style as ImageProps['style']}
      {...rest}
    />
  );
});

export default CachedImage;
