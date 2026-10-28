import React, { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import type { SemanticPalette } from '../../theme/palette';
import { Text } from '../../platform/Typography';
import JournalModal, { type JournalMenuAnchor } from './JournalModal';
import { JournalSearchInput } from './JournalHeader';
import { JournalPressable, useJournalReducedMotion, useJournalReducedTransparency } from './JournalMotion';

type JournalScope = 'checks' | 'warehouse';

export function JournalHeaderActions({
  palette,
  canSeeTrash,
  onBoard,
  onTrash,
}: {
  palette: SemanticPalette;
  canSeeTrash: boolean;
  onBoard: () => void;
  onTrash: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<JournalMenuAnchor>();
  const source = useRef<View>(null);
  return (
    <>
      <View ref={source} collapsable={false}>
        <JournalPressable
          style={s.action}
          onPress={() => {
            source.current?.measureInWindow((x, y, width, height) => setAnchor({ x, y, width, height }));
            setOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Ещё действия журнала"
          accessibilityState={{ expanded: open }}
        >
          <Ionicons name="ellipsis-horizontal" size={20} color={palette.text.primary} />
        </JournalPressable>
      </View>
      <JournalModal visible={open} onRequestClose={() => setOpen(false)} menu anchor={anchor}>
        <JournalPressable
          style={s.menuRow}
          accessibilityRole="button"
          accessibilityLabel="Открыть доску заказ-нарядов"
          onPress={() => {
            setOpen(false);
            onBoard();
          }}
        >
          <Ionicons name="albums-outline" size={20} color={palette.text.secondary} />
          <Text variant="bodyEmph" color={palette.text.primary} style={s.flex}>
            Доска заказ-нарядов
          </Text>
        </JournalPressable>
        {canSeeTrash && (
          <JournalPressable
            style={[s.menuRow, { borderTopWidth: StyleSheet.hairlineWidth, borderColor: palette.border.subtle }]}
            accessibilityRole="button"
            accessibilityLabel="Открыть корзину удалённых заказ-нарядов"
            onPress={() => {
              setOpen(false);
              onTrash();
            }}
          >
            <Ionicons name="trash-outline" size={20} color={palette.text.secondary} />
            <Text variant="bodyEmph" color={palette.text.primary} style={s.flex}>
              Корзина
            </Text>
          </JournalPressable>
        )}
      </JournalModal>
    </>
  );
}

export function JournalHeaderSegments({
  palette,
  active,
  onChange,
  compact = false,
}: {
  palette: SemanticPalette;
  active: JournalScope;
  onChange: (scope: JournalScope) => void;
  compact?: boolean;
}) {
  const { fontScale, width } = useWindowDimensions();
  const reduced = useJournalReducedMotion();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<JournalMenuAnchor>();
  const source = useRef<View>(null);
  const [railWidth, setRailWidth] = useState(0);
  const selected = useSharedValue(active === 'checks' ? 0 : 1);
  useEffect(() => {
    selected.value = reduced
      ? active === 'checks'
        ? 0
        : 1
      : withSpring(active === 'checks' ? 0 : 1, { duration: 230, dampingRatio: 1 });
  }, [active, reduced, selected]);
  const indicator = useAnimatedStyle(() => ({
    transform: [{ translateX: selected.value * Math.max(0, (railWidth - 6) / 2) }],
  }));
  const scopes = [
    { key: 'checks', label: 'Чеки' },
    { key: 'warehouse', label: 'Документы' },
  ] as const;
  if (fontScale > 1.3 || width < 370 || compact)
    return (
      <View ref={source} collapsable={false} style={compact ? undefined : s.flex}>
        <JournalPressable
          style={[compact ? s.action : s.scopePicker, { backgroundColor: palette.bg.muted }]}
          onPress={() => {
            source.current?.measureInWindow((x, y, measuredWidth, height) =>
              setAnchor({ x, y, width: measuredWidth, height }),
            );
            setOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel={`Раздел журнала: ${active === 'checks' ? 'Чеки' : 'Документы'}`}
          accessibilityState={{ expanded: open }}
        >
          {compact ? (
            <Ionicons
              name={active === 'checks' ? 'receipt-outline' : 'document-text-outline'}
              size={20}
              color={palette.accent.primaryText}
            />
          ) : (
            <>
              <Text variant="callout" color={palette.accent.primaryText} style={s.flex}>
                {active === 'checks' ? 'Чеки' : 'Документы'}
              </Text>
              <Ionicons name="chevron-down" size={14} color={palette.text.secondary} />
            </>
          )}
        </JournalPressable>
        <JournalModal visible={open} menu anchor={anchor} onRequestClose={() => setOpen(false)}>
          {scopes.map((scope) => (
            <JournalPressable
              key={scope.key}
              style={s.menuRow}
              accessibilityRole="tab"
              accessibilityState={{ selected: scope.key === active }}
              onPress={() => {
                onChange(scope.key);
                setOpen(false);
              }}
            >
              <Text variant="bodyEmph" color={palette.text.primary} style={s.flex}>
                {scope.label}
              </Text>
              {scope.key === active && <Ionicons name="checkmark" size={20} color={palette.accent.primaryText} />}
            </JournalPressable>
          ))}
        </JournalModal>
      </View>
    );
  return (
    <View
      onLayout={(event) => setRailWidth(event.nativeEvent.layout.width)}
      style={[s.segments, { backgroundColor: palette.bg.muted }]}
    >
      {railWidth > 0 && (
        <Animated.View
          testID="journal-scope-indicator"
          pointerEvents="none"
          style={[
            s.indicator,
            {
              width: (railWidth - 6) / 2,
              backgroundColor: palette.bg.card,
              shadowColor: palette.shadow.color,
              shadowOpacity: palette.shadow.elevatedOpacity,
            },
            indicator,
          ]}
        />
      )}
      {scopes.map((scope) => (
        <JournalPressable
          key={scope.key}
          accessibilityRole="tab"
          accessibilityLabel={scope.key === 'warehouse' ? 'Складские документы' : 'Чеки'}
          accessibilityState={{ selected: active === scope.key }}
          onPress={() => onChange(scope.key)}
          hitSlop={{ top: 3, bottom: 3 }}
          style={s.segment}
        >
          <Text variant="bodyEmph" color={active === scope.key ? palette.accent.primaryText : palette.text.secondary}>
            {scope.label}
          </Text>
        </JournalPressable>
      ))}
    </View>
  );
}

export function JournalCommandBar({
  palette,
  progress,
  active,
  onScopeChange,
  search,
  onSearchChange,
  onSearchFocus,
  filterCount,
  onFilters,
  actions,
}: {
  palette: SemanticPalette;
  progress: SharedValue<number>;
  active: JournalScope;
  onScopeChange: (scope: JournalScope) => void;
  search: string;
  onSearchChange: (value: string) => void;
  onSearchFocus: (focused: boolean) => void;
  filterCount: number;
  onFilters: () => void;
  actions: React.ReactNode;
}) {
  const [searching, setSearching] = useState(Boolean(search));
  const { fontScale } = useWindowDimensions();
  const reduced = useJournalReducedMotion();
  const opaque = useJournalReducedTransparency();
  const reveal = useSharedValue(searching ? 1 : 0);
  useEffect(() => {
    if (search) setSearching(true);
  }, [search]);
  useEffect(() => {
    reveal.value = withTiming(searching ? 1 : 0, {
      duration: reduced ? 90 : searching ? 250 : 200,
      easing: Easing.out(Easing.exp),
    });
  }, [searching, reveal, reduced]);
  const resting = useAnimatedStyle(() => ({
    opacity: interpolate(reveal.value, [0, 0.55, 1], [1, 0, 0]),
    transform: [{ translateX: reduced ? 0 : -18 * reveal.value }, { scale: reduced ? 1 : 1 - 0.025 * reveal.value }],
  }));
  const searchMotion = useAnimatedStyle(() => ({
    opacity: interpolate(reveal.value, [0, 0.15, 1], [0, 0, 1]),
    transform: [{ translateX: reduced ? 0 : 24 * (1 - reveal.value) }],
  }));
  const material = useAnimatedStyle(() => ({
    opacity: opaque || Platform.OS !== 'ios' ? 1 : 1 - progress.value * 0.22,
  }));
  return (
    <View
      testID="journal-command-bar"
      style={[
        s.carrier,
        {
          shadowColor: palette.shadow.color,
          shadowOpacity: palette.mode === 'dark' ? 0.24 : 0.09,
        },
      ]}
    >
      <View
        style={[
          s.carrierClip,
          { minHeight: Math.max(56, 22 * fontScale + 24) },
          Platform.OS === 'android' && { borderColor: palette.border.subtle, borderWidth: StyleSheet.hairlineWidth },
        ]}
      >
        {Platform.OS === 'ios' && !opaque && (
          <BlurView
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            intensity={palette.mode === 'dark' ? 30 : 45}
            tint={palette.mode === 'dark' ? 'systemThinMaterialDark' : 'systemThinMaterialLight'}
          />
        )}
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: palette.bg.elevated }, material]}
        />
        <Animated.View
          pointerEvents={searching ? 'none' : 'auto'}
          accessibilityElementsHidden={searching}
          importantForAccessibility={searching ? 'no-hide-descendants' : 'auto'}
          style={[s.commandRow, resting]}
        >
          <JournalHeaderSegments palette={palette} active={active} onChange={onScopeChange} />
          <View style={[s.separator, { backgroundColor: palette.border.subtle }]} />
          <JournalPressable
            style={s.action}
            accessibilityRole="button"
            accessibilityLabel="Поиск в журнале"
            onPress={() => setSearching(true)}
          >
            <Ionicons name="search" size={20} color={palette.text.primary} />
          </JournalPressable>
          <JournalPressable
            style={[s.action, filterCount > 0 && { backgroundColor: palette.accent.primarySoft }]}
            accessibilityRole="button"
            accessibilityLabel={`Фильтры${filterCount ? `, применено: ${filterCount}` : ''}`}
            onPress={onFilters}
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={filterCount ? palette.accent.primaryText : palette.text.primary}
            />
            {filterCount > 0 && (
              <View style={[s.count, { backgroundColor: palette.accent.primary, borderColor: palette.bg.elevated }]}>
                <Text variant="caption" color={palette.text.inverse} style={s.countText}>
                  {filterCount}
                </Text>
              </View>
            )}
          </JournalPressable>
          {actions}
        </Animated.View>
        <Animated.View
          pointerEvents={searching ? 'auto' : 'none'}
          accessibilityElementsHidden={!searching}
          importantForAccessibility={searching ? 'auto' : 'no-hide-descendants'}
          style={[s.searchOverlay, searchMotion]}
        >
          <JournalHeaderSegments palette={palette} active={active} onChange={onScopeChange} compact />
          <JournalPressable
            style={[s.action, filterCount > 0 && { backgroundColor: palette.accent.primarySoft }]}
            accessibilityRole="button"
            accessibilityLabel={`Фильтры поиска${filterCount ? `, применено: ${filterCount}` : ''}`}
            onPress={onFilters}
          >
            <Ionicons
              name="options-outline"
              size={20}
              color={filterCount ? palette.accent.primaryText : palette.text.primary}
            />
          </JournalPressable>
          <JournalSearchInput
            active={searching}
            value={search}
            onChange={onSearchChange}
            onFocusChange={onSearchFocus}
            onCancel={() => setSearching(false)}
            placeholder={active === 'checks' ? 'Клиент, телефон, госномер, № чека' : 'Название, поставщик, комментарий'}
          />
        </Animated.View>
      </View>
    </View>
  );
}
const touch = Platform.OS === 'android' ? 48 : 44;
const s = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  action: { width: touch, minHeight: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center' },
  menuRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  carrier: { borderRadius: 28, shadowOffset: { width: 0, height: 6 }, shadowRadius: 18, elevation: 5 },
  carrierClip: { borderRadius: 28, borderCurve: 'continuous', overflow: 'hidden', justifyContent: 'center' },
  commandRow: { flexDirection: 'row', alignItems: 'center', padding: 6, gap: 0 },
  separator: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 3 },
  segments: { flex: 1, minWidth: 0, flexDirection: 'row', borderRadius: 22, padding: 3 },
  indicator: {
    position: 'absolute',
    left: 3,
    top: 3,
    bottom: 3,
    borderRadius: 19,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 1,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touch - 6,
    paddingHorizontal: 5,
    paddingVertical: 6,
    borderRadius: 19,
  },
  scopePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touch,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 22,
    gap: 6,
  },
  count: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  countText: { fontWeight: '700', fontVariant: ['tabular-nums'] },
  searchOverlay: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'center', padding: 6, gap: 6 },
});
