import React, { ReactNode } from 'react';
import { Modal as RNModal, View, Text, TouchableOpacity, StyleSheet, Platform, Dimensions } from 'react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView, KeyboardProvider } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useColors } from '../contexts/ThemeContext';
import ModalBlurBackdrop from './ModalBlurBackdrop';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

/**
 * Modal — общий центрированный диалог (комментарий к чеку, форма возврата,
 * смена статуса и т.п.).
 *
 * КЛАВИАТУРА (Round 11 #1). Раньше это был центрированный блок в RN-core
 * `KeyboardAvoidingView behavior='padding'` без `keyboardVerticalOffset`: он
 * поднимал ВЕСЬ блок целиком (на iOS), из-за чего высокая модалка клипалась
 * сверху, а активное поле НЕ гарантированно оказывалось над клавиатурой —
 * это и был баг «пишу комментарий, поля не видно» на iPhone (поле
 * комментария живёт внутри этой модалки). На Android этот `behavior` был
 * вообще no-op.
 *
 * ТЕПЕРЬ — два слоя от keyboard-controller (одинаково iOS + Android, синхронно
 * с реальными кадрами клавиатуры):
 *   1. `KeyboardAvoidingView behavior="padding"` вокруг центрированного хоста —
 *      добавляет снизу отступ на высоту клавиатуры, поэтому центрированная
 *      карточка ПОДНИМАЕТСЯ и её низ выходит из-под клавиатуры (карточка
 *      capped `maxHeight: 0.85`, так что вверх не упирается в статус-бар).
 *   2. Тело — `KeyboardAwareScrollView`: авто-скроллит к активному `TextInput`,
 *      удерживая его ВИДИМЫМ над клавиатурой ВНУТРИ карточки (поведение
 *      WhatsApp/Telegram). `bottomOffset` держит запас под полем.
 * `keyboardDismissMode="interactive"` — клавиатура «оттягивается» жестом.
 *
 * ВЛОЖЕННЫЙ `KeyboardProvider`. RN-core `<Modal>` монтирует ОТДЕЛЬНОЕ нативное
 * окно — корневой `KeyboardProvider` из App.tsx туда НЕ дотягивается, и без
 * своего провайдера keyboard-controller тихо падает на defaultContext (в dev —
 * warning, в prod — просто no-op, поле снова прячется под клавиатурой). Поэтому
 * оборачиваем содержимое модалки в собственный `KeyboardProvider`.
 */
export default function Modal({ visible, onClose, title, children }: ModalProps) {
  const palette = useColors();
  return (
    <RNModal visible={visible} animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent>
      <KeyboardProvider>
        <ModalBlurBackdrop onPress={onClose} />
        {/* pointerEvents="box-none": сам overlay (flex:1, поверх бэкдропа) НЕ
            перехватывает тапы — тап МИМО карточки проваливается на
            ModalBlurBackdrop под ним → закрытие по фону (Round 11 #15,
            регресс от keyboard-обёртки). Тап по карточке и полям работает
            как обычно (карточка — дочерний touch-target). */}
        <KeyboardAvoidingView behavior="padding" style={styles.overlay} pointerEvents="box-none">
          <View style={[styles.sheet, { backgroundColor: palette.bg.elevated }]}>
            <View style={[styles.handle, { backgroundColor: palette.border.subtle }]} />
            <View style={[styles.header, { borderBottomColor: palette.border.subtle }]}>
              <Text style={[styles.title, { color: palette.text.primary }]}>{title}</Text>
              <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="close" size={20} color={palette.text.tertiary} />
              </TouchableOpacity>
            </View>
            <KeyboardAwareScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              // Активное поле остаётся видимым над клавиатурой с небольшим
              // запасом (авто-скролл к фокусу, не «поднять весь блок»).
              bottomOffset={spacing[6]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              showsVerticalScrollIndicator={false}
            >
              {children}
            </KeyboardAwareScrollView>
          </View>
        </KeyboardAvoidingView>
      </KeyboardProvider>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  sheet: {
    // backgroundColor comes from palette.bg.elevated (theme-aware) inline.
    // M3 Alert Dialog uses a 28pt extra-large container corner — wider
    // than the iOS 2xl (≈16-20pt) so the bottom corners read as more
    // "rounded surface" than "squircle". Branch so each platform feels
    // native.
    borderRadius: Platform.OS === 'android' ? 28 : borderRadius['2xl'],
    width: '100%',
    maxHeight: SCREEN_HEIGHT * 0.85,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 20,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    // backgroundColor from palette.border.subtle (theme-aware) inline.
    alignSelf: 'center',
    marginTop: spacing[3],
    marginBottom: spacing[1],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    // borderBottomColor from palette.border.subtle (theme-aware) inline.
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    // color from palette.text.primary (theme-aware) inline.
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    // backgroundColor from palette.bg.muted (theme-aware) inline.
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    maxHeight: SCREEN_HEIGHT * 0.65,
  },
  bodyContent: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[4],
    paddingBottom: spacing[6],
  },
});
