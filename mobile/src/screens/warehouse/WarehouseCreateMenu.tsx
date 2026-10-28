import React, { useRef, useState } from 'react';
import { Keyboard, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import { JournalPressable } from '../journal/JournalMotion';
import JournalModal, { type JournalMenuAnchor } from '../journal/JournalModal';

export default function WarehouseCreateMenu({
  onAdd,
  onCreateFolder,
}: {
  onAdd?: () => void;
  onCreateFolder?: () => void;
}) {
  const p = useColors();
  const { fontScale } = useWindowDimensions();
  const source = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<JournalMenuAnchor>();
  const pending = useRef<'product' | 'folder' | null>(null);
  const current = useRef({ onAdd, onCreateFolder });
  current.current = { onAdd, onCreateFolder };
  const close = () => {
    pending.current = null;
    setOpen(false);
  };
  const choose = (action: 'product' | 'folder') => {
    pending.current = action;
    setOpen(false);
  };
  return (
    <>
      <View ref={source} collapsable={false}>
        <JournalPressable
          style={[s.trigger, { backgroundColor: p.accent.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Добавить на склад"
          accessibilityState={{ expanded: open }}
          onPress={() => {
            pending.current = null;
            Keyboard.dismiss();
            if (source.current)
              source.current.measureInWindow((x, y, width, height) => {
                setAnchor({ x, y, width, height });
                setOpen(true);
              });
            else setOpen(true);
          }}
        >
          <Ionicons name="add" size={20} color={p.text.inverse} />
        </JournalPressable>
      </View>
      <JournalModal
        visible={open}
        menu
        anchor={anchor}
        onRequestClose={close}
        closeLabel="Закрыть меню создания"
        onExited={() => {
          const action = pending.current;
          pending.current = null;
          if (action === 'folder') current.current.onCreateFolder?.();
          if (action === 'product') current.current.onAdd?.();
        }}
      >
        {onCreateFolder && (
          <JournalPressable
            style={s.item}
            accessibilityRole="button"
            accessibilityLabel="Создать папку"
            onPress={() => choose('folder')}
          >
            <Ionicons name="folder-open-outline" size={20} color={p.accent.primaryText} />
            <Text
              variant="bodyEmph"
              allowFontScaling={false}
              color={p.text.primary}
              style={[s.label, { fontSize: 15 * fontScale, lineHeight: 22 * fontScale }]}
            >
              Создать папку
            </Text>
          </JournalPressable>
        )}
        {onAdd && (
          <JournalPressable
            style={[
              s.item,
              onCreateFolder && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border.subtle },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Добавить товар"
            onPress={() => choose('product')}
          >
            <Ionicons name="cube-outline" size={20} color={p.accent.primaryText} />
            <Text
              variant="bodyEmph"
              allowFontScaling={false}
              color={p.text.primary}
              style={[s.label, { fontSize: 15 * fontScale, lineHeight: 22 * fontScale }]}
            >
              Добавить товар
            </Text>
          </JournalPressable>
        )}
      </JournalModal>
    </>
  );
}
const touch = Platform.OS === 'android' ? 48 : 44;
const s = StyleSheet.create({
  trigger: { width: touch, minHeight: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center' },
  item: {
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: { flex: 1, minWidth: 0 },
});
