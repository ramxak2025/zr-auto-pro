import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import type { FreshnessQueryLike } from '../../components/FreshnessBadge';
import JournalContext from '../journal/JournalContext';
import WarehouseCreateMenu from './WarehouseCreateMenu';
import { JournalPressable, useJournalReducedMotion } from '../journal/JournalMotion';
import JournalHeader, { JournalSearchInput, type JournalScrollController } from '../journal/JournalHeader';

type Selection = {
  count: number;
  allSelected: boolean;
  canSelectAll: boolean;
  onCancel: () => void;
  onToggleAll: () => void;
};

/** Local presentation only: permission and warehouse decisions stay in ProductsScreen. */
export default function WarehouseHeader({
  scroll,
  warehouseName,
  countLabel,
  queries,
  search,
  onSearchChange,
  onWarehousePress,
  onScan,
  onOperations,
  onAdd,
  onCreateFolder,
  selection,
}: {
  scroll: JournalScrollController;
  warehouseName: string;
  countLabel?: string;
  queries: FreshnessQueryLike[];
  search: string;
  onSearchChange: (value: string) => void;
  onWarehousePress?: () => void;
  onScan: () => void;
  onOperations?: () => void;
  onAdd?: () => void;
  onCreateFolder?: () => void;
  selection?: Selection;
}) {
  const p = useColors();
  const { width, fontScale } = useWindowDimensions();
  const wideLabel = width < 360 || fontScale > 1.3;
  // Explicit full-scale metrics invalidate native intrinsic text measurement on
  // live Dynamic Type changes. Automatic scaling must not apply a second time.
  const font = {
    display: { fontSize: 34 * fontScale, lineHeight: 40 * fontScale },
    body: { fontSize: 15 * fontScale, lineHeight: 22 * fontScale },
    title: { fontSize: 17 * fontScale, lineHeight: 22 * fontScale },
    caption: { fontSize: 11 * fontScale, lineHeight: 14 * fontScale },
  };
  const reduced = useJournalReducedMotion();
  const [searching, setSearching] = useState(Boolean(search));
  const [searchHeight, setSearchHeight] = useState(touch + 6);
  const reveal = useSharedValue(searching ? 1 : 0);
  useEffect(() => {
    if (search) setSearching(true);
  }, [search]);
  useEffect(() => {
    reveal.value = withTiming(searching ? 1 : 0, {
      duration: reduced ? 90 : searching ? 250 : 200,
      easing: Easing.out(Easing.exp),
    });
  }, [searching, reduced, reveal]);
  const revealStyle = useAnimatedStyle(() => ({ height: searchHeight * reveal.value, opacity: reveal.value }));
  const fieldStyle = useAnimatedStyle(() => ({ transform: [{ translateY: reduced ? 0 : -8 * (1 - reveal.value) }] }));
  return (
    <JournalHeader
      scroll={scroll}
      title="Склад"
      context={<JournalContext queries={queries} />}
      hideHeading={Boolean(selection)}
    >
      {selection && (
        <>
          <View style={[s.selection, { backgroundColor: p.bg.canvas }]}>
            <JournalPressable
              style={s.selectionAction}
              onPress={selection.onCancel}
              accessibilityRole="button"
              accessibilityLabel="Отменить выбор товаров"
            >
              <Text variant="bodyEmph" color={p.accent.primaryText} allowFontScaling={false} style={font.body}>
                Отмена
              </Text>
            </JournalPressable>
            <Text
              variant="title3"
              color={p.text.primary}
              style={[s.selectionTitle, font.title]}
              allowFontScaling={false}
              accessibilityRole="header"
            >
              {selection.count ? `Выбрано ${selection.count}` : 'Выберите товары'}
            </Text>
            <JournalPressable
              style={s.selectionAction}
              onPress={selection.onToggleAll}
              disabled={!selection.canSelectAll}
              accessibilityRole="button"
              accessibilityLabel={selection.allSelected ? 'Снять весь выбор' : 'Выбрать все видимые товары'}
              accessibilityState={{ disabled: !selection.canSelectAll }}
            >
              <Text
                variant="bodyEmph"
                color={selection.canSelectAll ? p.accent.primaryText : p.text.secondary}
                allowFontScaling={false}
                style={font.body}
              >
                {selection.allSelected ? 'Снять всё' : 'Выбрать всё'}
              </Text>
            </JournalPressable>
          </View>
          <View style={[s.selectionStatus, { backgroundColor: p.bg.canvas }]}>
            <JournalContext queries={queries} />
          </View>
        </>
      )}

      <View
        style={[
          s.dock,
          {
            backgroundColor: p.bg.elevated,
            shadowColor: p.shadow.color,
            shadowOpacity: p.mode === 'dark' ? 0.24 : 0.09,
          },
        ]}
      >
        <View style={[s.commandRow, { flexWrap: wideLabel ? 'wrap' : 'nowrap' }]}>
          <JournalPressable
            style={[
              s.warehouse,
              {
                width: wideLabel ? '100%' : 'auto',
                flexBasis: wideLabel ? 'auto' : 0,
                flexGrow: wideLabel ? 0 : 1,
                flexShrink: wideLabel ? 0 : 1,
                backgroundColor: p.bg.muted,
              },
            ]}
            onPress={!selection ? onWarehousePress : undefined}
            disabled={Boolean(selection) || !onWarehousePress}
            accessibilityRole={!selection && onWarehousePress ? 'button' : 'text'}
            accessibilityLabel={`${!selection && onWarehousePress ? 'Сменить склад. ' : ''}Текущий склад: ${warehouseName}${countLabel ? `. ${countLabel}` : ''}`}
          >
            <View style={s.warehouseText}>
              <Text
                variant="bodyEmph"
                color={p.text.primary}
                numberOfLines={wideLabel ? undefined : 1}
                allowFontScaling={false}
                style={font.body}
              >
                {warehouseName}
              </Text>
              {!!countLabel && (
                <Text variant="caption" color={p.text.secondary} allowFontScaling={false} style={font.caption}>
                  {countLabel}
                </Text>
              )}
            </View>
            {!selection && onWarehousePress && <Ionicons name="chevron-down" size={14} color={p.text.secondary} />}
          </JournalPressable>
          <View
            style={[
              s.actions,
              { width: wideLabel ? '100%' : 'auto', justifyContent: wideLabel ? 'flex-end' : 'flex-start' },
            ]}
          >
            <JournalPressable
              style={[s.action, searching && { backgroundColor: p.accent.primarySoft }]}
              onPress={() => setSearching(true)}
              accessibilityRole="button"
              accessibilityLabel="Поиск товара"
              accessibilityState={{ expanded: searching }}
            >
              <Ionicons name="search" size={20} color={searching ? p.accent.primaryText : p.text.primary} />
            </JournalPressable>
            {!selection && (
              <JournalPressable
                style={s.action}
                onPress={onScan}
                accessibilityRole="button"
                accessibilityLabel="Сканировать штрих-код"
              >
                <Ionicons name="barcode-outline" size={20} color={p.text.primary} />
              </JournalPressable>
            )}
            {!selection && onOperations && (
              <JournalPressable
                style={s.action}
                onPress={onOperations}
                accessibilityRole="button"
                accessibilityLabel="Складские операции"
              >
                <Ionicons name="swap-horizontal-outline" size={20} color={p.text.primary} />
              </JournalPressable>
            )}
            {!selection && (onAdd || onCreateFolder) && (
              <WarehouseCreateMenu onAdd={onAdd} onCreateFolder={onCreateFolder} />
            )}
          </View>
        </View>
        <Animated.View
          pointerEvents={searching ? 'auto' : 'none'}
          accessibilityElementsHidden={!searching}
          importantForAccessibility={searching ? 'auto' : 'no-hide-descendants'}
          style={[s.reveal, revealStyle]}
        >
          <Animated.View
            style={[s.searchContent, fieldStyle]}
            onLayout={(event) => {
              const measuredHeight = event.nativeEvent.layout.height;
              setSearchHeight((previous) => (previous === measuredHeight ? previous : measuredHeight));
            }}
          >
            <JournalSearchInput
              active={searching}
              value={search}
              onChange={onSearchChange}
              onFocusChange={ignoreFocus}
              onCancel={() => setSearching(false)}
              placeholder="Поиск товара..."
            />
          </Animated.View>
        </Animated.View>
      </View>
    </JournalHeader>
  );
}
const ignoreFocus = (_focused: boolean) => undefined;
const touch = Platform.OS === 'android' ? 48 : 44;
const s = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  titleRow: {
    paddingHorizontal: 4,
    paddingTop: 14,
    paddingBottom: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 4,
  },
  title: { maxWidth: '100%' },
  status: { flexGrow: 1, maxWidth: '100%', alignItems: 'flex-end' },
  dock: {
    borderRadius: 28,
    borderCurve: 'continuous',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 18,
    elevation: 5,
  },
  commandRow: { flexDirection: 'row', alignItems: 'center', padding: 6, rowGap: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', flexGrow: 0, flexShrink: 0 },
  warehouse: {
    minWidth: 0,
    minHeight: touch,
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  warehouseText: { flex: 1, minWidth: 0 },
  action: { width: touch, minHeight: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center' },
  reveal: { overflow: 'hidden', borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  searchContent: { position: 'absolute', left: 6, right: 6, top: 0, paddingBottom: 6, flexDirection: 'row' },
  selection: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 6 },
  selectionAction: { minHeight: touch, maxWidth: '30%', justifyContent: 'center', paddingHorizontal: 4 },
  selectionTitle: { flex: 1, minWidth: 0, textAlign: 'center' },
  selectionStatus: { alignItems: 'flex-end', paddingBottom: 8 },
});
