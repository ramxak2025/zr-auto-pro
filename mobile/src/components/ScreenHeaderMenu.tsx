import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { colors } from '../theme';
import JournalModal, { type JournalMenuAnchor } from '../screens/journal/JournalModal';
import { JournalPressable } from '../screens/journal/JournalMotion';
import { HeaderAction } from './ScreenHeaderControls';

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];
type MenuAction = {
  type?: 'item';
  id: string;
  label: string;
  icon?: IoniconsName;
  onSelect: () => void;
  disabled?: boolean;
  loading?: boolean;
  selected?: boolean;
  danger?: boolean;
};
export type ScreenHeaderMenuEntry =
  | MenuAction
  | { type: 'label'; id: string; label: string }
  | { type: 'separator'; id: string };
interface Props {
  label: string;
  items: readonly (ScreenHeaderMenuEntry | false | null | undefined)[];
  icon?: IoniconsName;
  title?: string;
  tone?: 'default' | 'primary';
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
}
const isAction = (entry: ScreenHeaderMenuEntry): entry is MenuAction => !entry.type || entry.type === 'item';

/** JournalModal owns native presence. This caller owns only the pending command. */
export default function ScreenHeaderMenu({ label, items, icon, title, tone, loading, disabled, testID }: Props) {
  const p = useColors();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const source = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [present, setPresent] = useState(false);
  const [cycle, setCycle] = useState(0);
  const [measured, setMeasured] = useState<JournalMenuAnchor>();
  const generation = useRef(0);
  const visible = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<{ id: string; cycle: number } | null>(null);
  const entries = items.filter((item): item is ScreenHeaderMenuEntry => Boolean(item));
  const hasActions = entries.some(isAction);
  const current = useRef({ entries, disabled, loading, hasActions });
  current.current = { entries, disabled, loading, hasActions };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      visible.current = false;
      pending.current = null;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    if (!hasActions || disabled || loading) {
      pending.current = null;
      visible.current = false;
      setOpen(false);
    }
  }, [hasActions, disabled, loading]);

  const close = () => {
    pending.current = null;
    visible.current = false;
    setCycle(++generation.current);
    setOpen(false);
  };
  const show = () => {
    const latest = current.current;
    if (!mounted.current || latest.disabled || latest.loading || !latest.hasActions) return;
    const run = ++generation.current;
    pending.current = null;
    visible.current = true;
    setCycle(run);
    Keyboard.dismiss();
    const finishMeasure = (anchor?: JournalMenuAnchor) => {
      const latest = current.current;
      if (
        !mounted.current ||
        run !== generation.current ||
        !visible.current ||
        latest.disabled ||
        latest.loading ||
        !latest.hasActions
      )
        return;
      setMeasured(anchor);
      setPresent(true);
      setOpen(true);
    };
    if (source.current) source.current.measureInWindow((x, y, width, height) => finishMeasure({ x, y, width, height }));
    else finishMeasure();
  };
  const choose = (id: string) => {
    const latest = current.current;
    const entry = latest.entries.find((item): item is MenuAction => isAction(item) && item.id === id);
    if (!visible.current || latest.disabled || latest.loading || !entry || entry.disabled || entry.loading) return;
    pending.current = { id, cycle: generation.current };
    visible.current = false;
    setOpen(false);
  };
  const exited = () => {
    if (!mounted.current || visible.current || generation.current !== cycle) return;
    const selection = pending.current;
    pending.current = null;
    setPresent(false);
    const latest = current.current;
    if (!selection || selection.cycle !== cycle || latest.disabled || latest.loading) return;
    const entry = latest.entries.find((item): item is MenuAction => isAction(item) && item.id === selection.id);
    if (entry && !entry.disabled && !entry.loading) entry.onSelect();
  };

  // The approved host uses a 240pt panel, 16pt horizontal floors and a 180pt
  // lower-edge allowance. Bound the INNER scroll to the real remaining space.
  // No section controller or bottom-navigation reservation belongs in this popup.
  const panelWidth = Math.min(240, Math.max(0, width - 32));
  const maxRight = Math.max(16, width - panelWidth - insets.left - 16);
  const desiredRight = Math.max(
    insets.right + 16,
    Math.min(maxRight, measured ? width - measured.x - measured.width : 16),
  );
  const anchor = {
    x: width - desiredRight,
    y: Math.max(insets.top + 8, measured ? measured.y + measured.height + 8 : insets.top + 56) - 8,
    width: 0,
    height: 0,
  };
  const hostTop = Math.min(anchor.y + 8, height - insets.bottom - 180);
  const hostRight = Math.max(16, Math.min(width - 256, desiredRight));
  const actualPanelWidth = Math.min(240, Math.max(0, width - hostRight - 16));
  const hostLeft = width - hostRight - actualPanelWidth;
  const topClearance = Math.max(0, insets.top + 8 - hostTop - 4);
  const maxHeight = Math.max(
    1,
    Math.min(height - insets.bottom - 16 - hostTop - 8 - topClearance, height - insets.top - 16 - 8 - topClearance),
  );
  const danger = p.mode === 'dark' ? colors.red[400] : colors.red[600];
  if (!hasActions && !present) return null;
  return (
    <>
      {hasActions && (
        <View ref={source} collapsable={false} style={styles.trigger}>
          <HeaderAction
            label={label}
            icon={icon ?? (Platform.OS === 'ios' ? 'ellipsis-horizontal' : 'ellipsis-vertical')}
            title={title}
            tone={tone}
            loading={loading}
            disabled={disabled}
            testID={testID}
            accessibilityState={{ expanded: open }}
            onPress={show}
          />
        </View>
      )}
      {present && (
        <JournalModal
          visible={open && hasActions}
          menu
          anchor={anchor}
          onRequestClose={close}
          onExited={exited}
          closeLabel={`Закрыть: ${label}`}
        >
          <ScrollView
            testID={testID ? `${testID}-content` : undefined}
            style={{
              maxHeight,
              marginTop: topClearance,
              marginLeft: Math.max(0, insets.left + 16 - hostLeft),
              marginRight: Math.max(0, insets.right + 16 - hostRight),
            }}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            contentInsetAdjustmentBehavior="never"
          >
            {entries.map((entry) => {
              if (entry.type === 'separator')
                return (
                  <View
                    key={entry.id}
                    accessibilityElementsHidden
                    style={[styles.separator, { backgroundColor: p.border.subtle }]}
                  />
                );
              if (entry.type === 'label')
                return (
                  <Text
                    key={entry.id}
                    accessibilityRole="header"
                    variant="footnote"
                    color={p.text.secondary}
                    style={styles.group}
                  >
                    {entry.label}
                  </Text>
                );
              const unavailable = Boolean(entry.disabled || entry.loading);
              const color = entry.danger ? danger : p.text.primary;
              return (
                <JournalPressable
                  key={entry.id}
                  testID={testID ? `${testID}-item-${entry.id}` : undefined}
                  accessibilityRole="button"
                  accessibilityLabel={entry.label}
                  accessibilityState={{
                    disabled: unavailable,
                    busy: Boolean(entry.loading),
                    selected: Boolean(entry.selected),
                  }}
                  disabled={unavailable}
                  onPress={() => choose(entry.id)}
                  style={[styles.item, { opacity: unavailable ? 0.45 : 1 }]}
                >
                  {entry.loading ? (
                    <ActivityIndicator size="small" color={color} />
                  ) : entry.icon ? (
                    <Ionicons name={entry.icon} size={20} color={entry.danger ? danger : p.accent.primaryText} />
                  ) : null}
                  <Text variant="body" color={color} style={styles.label}>
                    {entry.label}
                  </Text>
                  {entry.selected && <Ionicons name="checkmark" size={20} color={p.accent.primaryText} />}
                </JournalPressable>
              );
            })}
          </ScrollView>
        </JournalModal>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  trigger: { flexShrink: 1 },
  content: { paddingVertical: 2 },
  item: {
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: { flex: 1, minWidth: 0 },
  group: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6 },
  separator: { height: StyleSheet.hairlineWidth, marginHorizontal: 14, marginVertical: 6 },
});
