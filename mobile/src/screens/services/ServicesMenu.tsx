import React, { useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import { JournalPressable } from '../journal/JournalMotion';
import JournalModal, { type JournalMenuAnchor } from '../journal/JournalModal';

export type ServicesMenuItem = {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onSelect: () => void;
  disabled?: boolean;
  selected?: boolean;
};

/** Service actions keep their existing screen handlers and run after native dismissal. */
export default function ServicesMenu({
  label,
  icon,
  items,
  primary = false,
  triggerContent,
  triggerStyle,
  containerStyle,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  items: ServicesMenuItem[];
  primary?: boolean;
  triggerContent?: React.ReactNode;
  triggerStyle?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const p = useColors();
  const { fontScale } = useWindowDimensions();
  const source = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<JournalMenuAnchor>();
  const pending = useRef<string | null>(null);
  const current = useRef(items);
  const mounted = useRef(true);
  const generation = useRef(0);
  current.current = items;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current = null;
      generation.current += 1;
    };
  }, []);
  const close = () => {
    generation.current += 1;
    pending.current = null;
    setOpen(false);
  };
  if (items.length === 0) return null;
  return (
    <>
      <View ref={source} collapsable={false} style={containerStyle}>
        <JournalPressable
          style={[s.trigger, primary && { backgroundColor: p.accent.primary }, triggerStyle]}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            pending.current = null;
            const run = ++generation.current;
            Keyboard.dismiss();
            const show = (nextAnchor?: JournalMenuAnchor) => {
              if (!mounted.current || generation.current !== run || current.current.length === 0) return;
              setAnchor(nextAnchor);
              setOpen(true);
            };
            if (source.current) source.current.measureInWindow((x, y, width, height) => show({ x, y, width, height }));
            else show();
          }}
        >
          {triggerContent ?? <Ionicons name={icon} size={20} color={primary ? p.text.inverse : p.text.primary} />}
        </JournalPressable>
      </View>
      <JournalModal
        visible={open}
        menu
        anchor={anchor}
        onRequestClose={close}
        closeLabel={`Закрыть меню «${label}»`}
        onExited={() => {
          const key = pending.current;
          pending.current = null;
          const action = current.current.find((item) => item.key === key);
          if (mounted.current && action && !action.disabled) action.onSelect();
        }}
      >
        {items.map((item, index) => (
          <JournalPressable
            key={item.key}
            style={[
              s.item,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: p.border.subtle },
              item.disabled && { opacity: 0.45 },
            ]}
            disabled={item.disabled}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ disabled: Boolean(item.disabled), selected: item.selected }}
            onPress={() => {
              if (item.disabled) return;
              pending.current = item.key;
              setOpen(false);
            }}
          >
            <Ionicons name={item.icon} size={20} color={p.accent.primaryText} />
            <Text
              variant="bodyEmph"
              allowFontScaling={false}
              color={p.text.primary}
              style={[s.label, { fontSize: 15 * fontScale, lineHeight: 22 * fontScale }]}
            >
              {item.label}
            </Text>
            {item.selected && <Ionicons name="checkmark" size={18} color={p.accent.primaryText} />}
          </JournalPressable>
        ))}
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
