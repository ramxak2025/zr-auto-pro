/**
 * AdminBroadcastScreen — compose + send a platform-wide announcement
 * («объявление от поддержки») to every tenant owner.
 *
 *   • Fields: title, body, optional imageUrl (URL or upload), up to 3 buttons
 *     ({ label, action: 'dismiss' | 'link', url? }).
 *   • LIVE PREVIEW reuses the real <BroadcastModal> so what the superadmin
 *     sees is exactly what owners get — no duplicated card markup.
 *   • «Отправить всем владельцам» → notificationsApi.createBroadcast(...) with
 *     a confirm dialog, success haptic + toast.
 */
import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useMutation } from '@tanstack/react-query';
import { notificationsApi, uploadsApi } from '../../api/services';
import { getImageUrl } from '../../api/axios';
import IosScreenHeader from '../../components/IosScreenHeader';
import BroadcastModal from '../../components/BroadcastModal';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type { Broadcast, BroadcastButton } from '../../../../shared/types';

interface DraftButton {
  label: string;
  action: 'dismiss' | 'link';
  url: string;
}

const MAX_BUTTONS = 3;

export default function AdminBroadcastScreen() {
  const palette = useColors();
  const surface = useIosSurface();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();

  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [imageUrl, setImageUrl] = React.useState('');
  const [buttons, setButtons] = React.useState<DraftButton[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);

  // Sanitise draft → the exact shape createBroadcast / BroadcastModal expect.
  const cleanButtons = React.useMemo<BroadcastButton[]>(
    () =>
      buttons
        .filter((b) => b.label.trim().length > 0)
        .map((b) =>
          b.action === 'link' && b.url.trim()
            ? { label: b.label.trim(), action: 'link' as const, url: b.url.trim() }
            : { label: b.label.trim(), action: 'dismiss' as const },
        ),
    [buttons],
  );

  // Preview broadcast object (id/createdAt are placeholders — BroadcastModal
  // only reads title/body/imageUrl/buttons).
  const previewBroadcast = React.useMemo<Broadcast>(
    () => ({
      id: 'preview',
      title: title.trim() || 'Заголовок объявления',
      body: body.trim() || 'Текст объявления появится здесь.',
      imageUrl: imageUrl.trim() ? getImageUrl(imageUrl.trim()) : undefined,
      buttons: cleanButtons,
      createdAt: new Date().toISOString(),
    }),
    [title, body, imageUrl, cleanButtons],
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      await notificationsApi.createBroadcast({
        title: title.trim(),
        body: body.trim(),
        imageUrl: imageUrl.trim() || undefined,
        buttons: cleanButtons.length > 0 ? cleanButtons : undefined,
      });
    },
    onSuccess: () => {
      haptic('success');
      setTitle('');
      setBody('');
      setImageUrl('');
      setButtons([]);
      setToast('Объявление отправлено всем владельцам');
      setTimeout(() => setToast(null), 2800);
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось отправить объявление');
    },
  });

  const pickImage = React.useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      setUploading(true);
      const up = await uploadsApi.upload(asset.uri, asset.fileName || 'broadcast.jpg');
      setImageUrl(up.data.url);
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить изображение.');
    } finally {
      setUploading(false);
    }
  }, []);

  const handleSend = React.useCallback(() => {
    if (!title.trim()) {
      Alert.alert('Укажите заголовок', 'Заголовок объявления обязателен.');
      return;
    }
    if (!body.trim()) {
      Alert.alert('Укажите текст', 'Текст объявления обязателен.');
      return;
    }
    haptic('warning');
    Alert.alert(
      'Отправить всем владельцам?',
      'Объявление получат владельцы всех тенантов в виде push-уведомления и карточки в приложении.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Отправить', style: 'destructive', onPress: () => sendMutation.mutate() },
      ],
    );
  }, [title, body, sendMutation]);

  const addButton = React.useCallback(() => {
    if (buttons.length >= MAX_BUTTONS) return;
    haptic('tap');
    setButtons([...buttons, { label: '', action: 'dismiss', url: '' }]);
  }, [buttons]);

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Рассылка"
        subtitle="Объявление владельцам"
        trailing={
          <Pressable
            onPress={() => {
              haptic('tap');
              setPreviewOpen(true);
            }}
            style={[styles.previewBtn, { backgroundColor: palette.bg.muted }]}
            hitSlop={6}
          >
            <Ionicons name="eye-outline" size={20} color={palette.text.primary} />
          </Pressable>
        }
      />

      <ScrollView
        contentInset={contentInset}
        contentContainerStyle={[styles.scroll, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <Text style={[styles.label, { color: palette.text.tertiary }]}>Заголовок</Text>
        <View style={[styles.inputCard, surface.card]}>
          <TextInput
            style={[styles.input, { color: palette.text.primary }]}
            placeholder="Например, Новая функция"
            placeholderTextColor={palette.text.tertiary}
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />
        </View>

        {/* Body */}
        <Text style={[styles.label, { color: palette.text.tertiary }]}>Текст</Text>
        <View style={[styles.inputCard, surface.card]}>
          <TextInput
            style={[styles.input, styles.multiline, { color: palette.text.primary }]}
            placeholder="Опишите объявление…"
            placeholderTextColor={palette.text.tertiary}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={600}
          />
        </View>

        {/* Image */}
        <Text style={[styles.label, { color: palette.text.tertiary }]}>Изображение (необязательно)</Text>
        <View style={[styles.inputCard, surface.card, styles.imageRow]}>
          <TextInput
            style={[styles.input, { flex: 1, color: palette.text.primary }]}
            placeholder="URL или загрузите файл"
            placeholderTextColor={palette.text.tertiary}
            value={imageUrl}
            onChangeText={setImageUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {imageUrl.length > 0 && (
            <Pressable onPress={() => setImageUrl('')} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={palette.text.tertiary} />
            </Pressable>
          )}
          <Pressable onPress={pickImage} disabled={uploading} style={[styles.uploadBtn, { backgroundColor: palette.accent.primarySoft }]} hitSlop={6}>
            {uploading ? (
              <ActivityIndicator size="small" color={palette.accent.primaryText} />
            ) : (
              <Ionicons name="image-outline" size={18} color={palette.accent.primaryText} />
            )}
          </Pressable>
        </View>

        {/* Buttons */}
        <View style={styles.btnsHead}>
          <Text style={[styles.label, { color: palette.text.tertiary, marginBottom: 0 }]}>
            Кнопки ({buttons.length}/{MAX_BUTTONS})
          </Text>
          {buttons.length < MAX_BUTTONS && (
            <Pressable onPress={addButton} style={styles.addBtnRow} hitSlop={6}>
              <Ionicons name="add-circle" size={18} color={palette.accent.primary} />
              <Text style={[styles.addBtnText, { color: palette.accent.primary }]}>Добавить</Text>
            </Pressable>
          )}
        </View>

        {buttons.map((btn, idx) => (
          <View key={idx} style={[styles.inputCard, surface.card, { gap: spacing[2.5] }]}>
            <View style={styles.btnTopRow}>
              <TextInput
                style={[styles.input, { flex: 1, color: palette.text.primary }]}
                placeholder={`Текст кнопки ${idx + 1}`}
                placeholderTextColor={palette.text.tertiary}
                value={btn.label}
                onChangeText={(v) => setButtons(buttons.map((b, i) => (i === idx ? { ...b, label: v } : b)))}
                maxLength={30}
              />
              <Pressable
                onPress={() => {
                  haptic('tap');
                  setButtons(buttons.filter((_, i) => i !== idx));
                }}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={18} color={colors.red[500]} />
              </Pressable>
            </View>
            <View style={styles.actionToggle}>
              {(['dismiss', 'link'] as const).map((act) => {
                const on = btn.action === act;
                return (
                  <Pressable
                    key={act}
                    onPress={() => {
                      haptic('select');
                      setButtons(buttons.map((b, i) => (i === idx ? { ...b, action: act } : b)));
                    }}
                    style={[
                      styles.actionChip,
                      {
                        backgroundColor: on ? palette.accent.primary : palette.bg.muted,
                      },
                    ]}
                  >
                    <Text style={[styles.actionChipText, { color: on ? '#fff' : palette.text.secondary }]}>
                      {act === 'dismiss' ? 'Закрыть' : 'Ссылка'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {btn.action === 'link' && (
              <TextInput
                style={[styles.input, styles.linkInput, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                placeholder="https://…"
                placeholderTextColor={palette.text.tertiary}
                value={btn.url}
                onChangeText={(v) => setButtons(buttons.map((b, i) => (i === idx ? { ...b, url: v } : b)))}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            )}
          </View>
        ))}

        {/* Send */}
        <Pressable
          onPress={handleSend}
          disabled={sendMutation.isPending}
          style={[styles.sendBtn, { backgroundColor: palette.accent.primary }]}
        >
          {sendMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons name="megaphone" size={18} color={colors.white} />
              <Text style={styles.sendText}>Отправить всем владельцам</Text>
            </>
          )}
        </Pressable>
      </ScrollView>

      {/* Live preview — the ACTUAL BroadcastModal owners will see. */}
      <BroadcastModal broadcast={previewOpen ? previewBroadcast : null} onDismiss={() => setPreviewOpen(false)} />

      {/* Toast */}
      {toast && (
        <View style={[styles.toast, { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle }]}>
          <Ionicons name="checkmark-circle" size={18} color={colors.green[500]} />
          <Text style={[styles.toastText, { color: palette.text.primary }]}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  previewBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[1.5] },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2.5],
    marginBottom: spacing[1.5],
    marginLeft: spacing[1],
  },
  inputCard: { paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  input: { fontSize: 16, paddingVertical: spacing[3] },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  uploadBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  btnsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[2.5],
    marginBottom: spacing[1.5],
    paddingHorizontal: spacing[1],
  },
  addBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnText: { fontSize: 14, fontWeight: '600' },
  btnTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  actionToggle: { flexDirection: 'row', gap: spacing[2], paddingBottom: spacing[2] },
  actionChip: { paddingHorizontal: spacing[4], paddingVertical: spacing[2], borderRadius: borderRadius.full },
  actionChipText: { fontSize: 13, fontWeight: '600' },
  linkInput: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[2],
    marginBottom: spacing[1],
  },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
    borderRadius: borderRadius['2xl'],
    marginTop: spacing[5],
  },
  sendText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  toast: {
    position: 'absolute',
    left: spacing[5],
    right: spacing[5],
    bottom: spacing[24],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  toastText: { fontSize: 14, fontWeight: '600', flex: 1 },
});
