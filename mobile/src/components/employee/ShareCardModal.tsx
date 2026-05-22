/**
 * ShareCardModal — preview + capture flow for sharing the employee
 * card as a 1080×1920 PNG.
 *
 * Flow:
 *   1. Modal shows the rendered <ShareCard> at preview size.
 *   2. "Поделиться" → captureRef → expo-sharing.shareAsync (system share sheet)
 *   3. "Сохранить" → captureRef → media-library.saveToLibraryAsync
 *
 * Both buttons fall back to `Alert` if the platform refuses the action.
 * Capture is forced to 1080×1920 via captureRef options — the on-screen
 * card stays compact for layout but the exported PNG is high-res.
 */
import React from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import { ShareCard, type ShareCardData, SHARE_CARD_EXPORT_HEIGHT, SHARE_CARD_EXPORT_WIDTH } from './ShareCard';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../../theme';

export interface ShareCardModalProps {
  visible: boolean;
  onClose: () => void;
  data: ShareCardData | null;
}

export function ShareCardModal({ visible, onClose, data }: ShareCardModalProps) {
  const cardRef = React.useRef<View>(null);
  const [busy, setBusy] = React.useState<'share' | 'save' | null>(null);

  const capture = React.useCallback(async () => {
    if (!cardRef.current) return null;
    return await captureRef(cardRef as any, {
      format: 'png',
      quality: 1,
      result: 'tmpfile',
      width: SHARE_CARD_EXPORT_WIDTH,
      height: SHARE_CARD_EXPORT_HEIGHT,
    });
  }, []);

  const onShare = async () => {
    if (busy) return;
    setBusy('share');
    haptic('select');
    try {
      const uri = await capture();
      if (!uri) {
        Alert.alert('Не удалось подготовить картинку');
        return;
      }
      const ok = await Sharing.isAvailableAsync();
      if (ok) {
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Поделиться карточкой',
          UTI: 'public.png',
        });
      } else {
        Alert.alert('Шаринг недоступен', uri);
      }
    } catch (e: any) {
      Alert.alert('Ошибка', String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  const onSave = async () => {
    if (busy) return;
    setBusy('save');
    haptic('select');
    try {
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (perm.status !== 'granted') {
        Alert.alert('Нет доступа', 'Разрешите доступ к фото в Настройках, чтобы сохранять карточки.');
        return;
      }
      const uri = await capture();
      if (!uri) {
        Alert.alert('Не удалось подготовить картинку');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      haptic('success');
      Alert.alert('Сохранено', 'Карточка добавлена в галерею');
    } catch (e: any) {
      Alert.alert('Ошибка', String(e?.message || e));
    } finally {
      setBusy(null);
    }
  };

  if (!data) return null;

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          alwaysBounceVertical={false}
        >
          <View style={styles.titleRow}>
            <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={10}>
              <Ionicons name="close" size={22} color="#fff" />
            </Pressable>
            <Text style={styles.title}>Карточка сотрудника</Text>
            <View style={styles.closeBtn} />
          </View>

          <View style={styles.cardWrap}>
            <ShareCard ref={cardRef} data={data} />
          </View>

          <View style={styles.actions}>
            <Pressable
              onPress={onSave}
              style={({ pressed }) => [styles.btn, styles.btnSecondary, pressed && { opacity: 0.6 }]}
              disabled={busy !== null}
            >
              <Ionicons name="download-outline" size={18} color="#0F172A" />
              <Text style={styles.btnTextSecondary}>{busy === 'save' ? 'Сохраняем…' : 'Сохранить'}</Text>
            </Pressable>
            <Pressable
              onPress={onShare}
              style={({ pressed }) => [styles.btn, styles.btnPrimary, pressed && { opacity: 0.85 }]}
              disabled={busy !== null}
            >
              <Ionicons name="share-outline" size={18} color="#fff" />
              <Text style={styles.btnTextPrimary}>{busy === 'share' ? 'Открываем…' : 'Поделиться'}</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Картинка экспортируется в PNG 1080×1920. Подходит для Instagram Stories, WhatsApp, Telegram.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  body: {
    flexGrow: 1,
    padding: spacing[4],
    paddingTop: 56,
    paddingBottom: 32,
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: spacing[3],
  },
  title: { color: '#fff', fontSize: fontSize.lg, fontWeight: fontWeight.bold, letterSpacing: -0.3 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardWrap: {
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 30,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[4],
    width: '100%',
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: borderRadius.xl,
  },
  btnPrimary: { backgroundColor: colors.primary[600] },
  btnSecondary: { backgroundColor: '#fff' },
  btnTextPrimary: { color: '#fff', fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  btnTextSecondary: { color: '#0F172A', fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  hint: {
    marginTop: spacing[3],
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    textAlign: 'center',
    paddingHorizontal: spacing[4],
  },
});
