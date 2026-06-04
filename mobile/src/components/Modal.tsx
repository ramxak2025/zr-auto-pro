import React, { ReactNode } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from 'react-native';
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

export default function Modal({ visible, onClose, title, children }: ModalProps) {
  const palette = useColors();
  return (
    <RNModal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.overlay}>
        <ModalBlurBackdrop onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: palette.bg.elevated }]}>
          <View style={[styles.handle, { backgroundColor: palette.border.subtle }]} />
          <View style={[styles.header, { borderBottomColor: palette.border.subtle }]}>
            <Text style={[styles.title, { color: palette.text.primary }]}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={[styles.closeBtn, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="close" size={20} color={palette.text.tertiary} />
            </TouchableOpacity>
          </View>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
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
