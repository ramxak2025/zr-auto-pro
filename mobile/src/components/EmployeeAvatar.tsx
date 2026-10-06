import React, { useEffect, useState } from 'react';
import { View, type StyleProp, type ViewStyle, type ImageStyle } from 'react-native';
import CachedImage from './CachedImage';
import { getImageUrl } from '../api/axios';

/** Canonical employee identity image. `photoUrl` is opt-in for legacy detail surfaces. */
export default function EmployeeAvatar({
  avatar,
  photoUrl,
  userId,
  style,
  imageStyle,
  children,
}: {
  avatar?: string | null;
  photoUrl?: string | null;
  userId?: string;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  children: React.ReactNode;
}) {
  const uri = getImageUrl(avatar) ?? getImageUrl(photoUrl);
  const [failedImage, setFailedImage] = useState<{ uri: string; userId?: string }>();
  useEffect(() => setFailedImage(undefined), [uri, userId]);
  const failedForCurrentImage = failedImage?.uri === uri && failedImage?.userId === userId;
  const showImage = !!uri && !failedForCurrentImage;

  return (
    <View style={style}>
      {showImage ? (
        <CachedImage
          key={uri}
          source={{ uri }}
          style={imageStyle}
          variant="thumb"
          recyclingKey={userId ?? uri}
          onError={() => setFailedImage({ uri, userId })}
        />
      ) : (
        children
      )}
    </View>
  );
}
