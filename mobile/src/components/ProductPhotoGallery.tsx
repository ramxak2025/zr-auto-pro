import React, { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import CachedImage from './CachedImage';
import { Text } from '../platform/Typography';
import { getImageUrl } from '../api/axios';
import { useColors } from '../contexts/ThemeContext';
import { moveProductPhoto, MAX_PRODUCT_PHOTOS } from '../../../shared/utils/productPhotos';

export default function ProductPhotoGallery({
  photos,
  onChange,
  onPick,
  disabled = false,
}: {
  photos: string[];
  onChange?: (photos: string[]) => void;
  onPick?: (index: number | null) => void;
  disabled?: boolean;
}) {
  const palette = useColors();
  const window = useWindowDimensions();
  const [width, setWidth] = useState(Math.max(1, window.width - 32));
  const [index, setIndex] = useState(0);
  const [fullIndex, setFullIndex] = useState<number | null>(null);
  const scroll = useRef<ScrollView>(null);
  const uri = (value: string) => (/^(?:file|content):/.test(value) ? value : getImageUrl(value));
  return (
    <View style={{ gap: 8 }}>
      {photos.length ? (
        <>
          <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
            <ScrollView
              ref={scroll}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
            >
              {photos.map((photo, at) => (
                <Pressable
                  key={`${at}-${photo}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Открыть фото ${at + 1} из ${photos.length}`}
                  onPress={() => setFullIndex(at)}
                  style={{
                    width,
                    height: 240,
                    backgroundColor: palette.bg.muted,
                    borderRadius: 16,
                    overflow: 'hidden',
                  }}
                >
                  <CachedImage source={{ uri: uri(photo) }} style={StyleSheet.absoluteFill} resizeMode="contain" />
                </Pressable>
              ))}
            </ScrollView>
          </View>
          <Text
            style={{ textAlign: 'center', fontSize: 13, fontVariant: ['tabular-nums'] }}
            color={palette.text.secondary}
          >
            {Math.min(index, photos.length - 1) + 1} / {photos.length}
          </Text>
        </>
      ) : (
        <View
          style={{
            height: 120,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.bg.muted,
            borderRadius: 16,
          }}
        >
          <Ionicons name="images-outline" size={32} color={palette.text.tertiary} />
          <Text color={palette.text.secondary}>Нет фотографий</Text>
        </View>
      )}
      {onChange && onPick ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {photos.map((photo, at) => (
              <View key={`${at}-${photo}`} style={{ width: 94, gap: 4 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Заменить фото ${at + 1}`}
                  disabled={disabled}
                  onPress={() => onPick(at)}
                >
                  <CachedImage
                    source={{ uri: uri(photo) }}
                    style={{ height: 72, width: 94, borderRadius: 12 }}
                    resizeMode="cover"
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Удалить фото ${at + 1}`}
                  disabled={disabled}
                  onPress={() => onChange(photos.filter((_, item) => item !== at))}
                  style={styles.action}
                >
                  <Text color={palette.text.secondary} style={styles.small}>
                    Удалить
                  </Text>
                </Pressable>
                {at === 0 ? (
                  <Text color={palette.text.secondary} style={[styles.small, { textAlign: 'center' }]}>
                    Обложка
                  </Text>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Фото ${at + 1} на обложку`}
                    disabled={disabled}
                    onPress={() => {
                      onChange(moveProductPhoto(photos, at, 0));
                      setIndex(0);
                      scroll.current?.scrollTo({ x: 0, animated: false });
                    }}
                    style={styles.action}
                  >
                    <Text color={palette.accent.primaryText} style={styles.small}>
                      На обложку
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </ScrollView>
          {photos.length < MAX_PRODUCT_PHOTOS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Добавить фото товара"
              disabled={disabled}
              onPress={() => onPick(null)}
              style={[styles.add, { backgroundColor: palette.bg.muted, opacity: disabled ? 0.5 : 1 }]}
            >
              <Ionicons name="camera-outline" size={19} color={palette.accent.primaryText} />
              <Text color={palette.accent.primaryText}>Добавить фото · {photos.length}/4</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}
      <Modal visible={fullIndex !== null} animationType="fade" onRequestClose={() => setFullIndex(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
            }}
          >
            <Text color="#fff">
              {(fullIndex ?? 0) + 1} / {photos.length}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Закрыть просмотр"
              onPress={() => setFullIndex(null)}
              style={styles.action}
            >
              <Ionicons name="close" size={26} color="#fff" />
            </Pressable>
          </View>
          {fullIndex !== null && (
            <ScrollView
              key={fullIndex === null ? 'closed' : 'open'}
              horizontal
              pagingEnabled
              contentOffset={{ x: fullIndex * window.width, y: 0 }}
              onMomentumScrollEnd={(event) =>
                setFullIndex(Math.round(event.nativeEvent.contentOffset.x / window.width))
              }
              showsHorizontalScrollIndicator={false}
            >
              {photos.map((photo, at) => (
                <View key={`${at}-${photo}`} style={{ width: window.width, flex: 1 }}>
                  <CachedImage
                    source={{ uri: uri(photo) }}
                    style={{ flex: 1, width: window.width }}
                    resizeMode="contain"
                  />
                </View>
              ))}
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  action: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  small: { fontSize: 12 },
  add: {
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});
