import React from 'react';
import { Image, ImageProps, ImageSource } from 'expo-image';
import type { StyleProp, ImageStyle } from 'react-native';

/**
 * Drop-in replacement for react-native `<Image>` that uses expo-image
 * under the hood with memory+disk caching.
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

const CachedImage = React.memo(function CachedImage({
  source,
  resizeMode = 'cover',
  style,
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
      transition={120}
      style={style as ImageProps['style']}
      {...rest}
    />
  );
});

export default CachedImage;
