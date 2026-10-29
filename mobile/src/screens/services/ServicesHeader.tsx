import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import type { FreshnessQueryLike } from '../../components/FreshnessBadge';
import JournalContext from '../journal/JournalContext';
import { JournalPressable, useJournalReducedMotion } from '../journal/JournalMotion';
import JournalHeader, { JournalSearchInput, type JournalScrollController } from '../journal/JournalHeader';
import ServicesMenu, { type ServicesMenuItem } from './ServicesMenu';

/** Warehouse's measured header and native search, with service-only actions. */
export default function ServicesHeader({
  scroll,
  folderName,
  folderPath,
  countLabel,
  queries,
  search,
  onSearchChange,
  onBack,
  onAdd,
  onCreateFolder,
  onVisibility,
  visibilityDisabled,
  onToggleShowAll,
  showAll,
  onManageFolder,
}: {
  scroll: JournalScrollController;
  folderName: string;
  folderPath: string;
  countLabel?: string;
  queries: FreshnessQueryLike[];
  search: string;
  onSearchChange: (value: string) => void;
  onBack: () => void;
  onAdd?: () => void;
  onCreateFolder?: () => void;
  onVisibility?: () => void;
  visibilityDisabled?: boolean;
  onToggleShowAll?: () => void;
  showAll: boolean;
  onManageFolder?: () => void;
}) {
  const p = useColors();
  const { width, fontScale } = useWindowDimensions();
  const wideLabel = width < 360 || fontScale > 1.3;
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
  const createItems: ServicesMenuItem[] = [];
  if (onCreateFolder)
    createItems.push({ key: 'folder', label: 'Новая папка', icon: 'folder-open-outline', onSelect: onCreateFolder });
  if (onAdd) createItems.push({ key: 'service', label: 'Новая услуга', icon: 'add', onSelect: onAdd });
  const actions: ServicesMenuItem[] = [];
  if (onToggleShowAll)
    actions.push({
      key: 'scope',
      label: showAll ? 'Показ по роли' : 'Все услуги',
      icon: showAll ? 'eye-off-outline' : 'eye-outline',
      onSelect: onToggleShowAll,
    });
  if (onVisibility)
    actions.push({
      key: 'visibility',
      label: 'Видимость по ролям',
      icon: 'shield-checkmark-outline',
      onSelect: onVisibility,
      disabled: visibilityDisabled,
    });
  if (onManageFolder)
    actions.push({
      key: `folder:${folderPath}`,
      label: 'Управление папкой',
      icon: 'folder-outline',
      onSelect: onManageFolder,
    });
  return (
    <JournalHeader title="Услуги" scroll={scroll} context={<JournalContext queries={queries} />}>
      <View
        testID="services-header-dock"
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
          <View
            style={[
              s.identity,
              {
                width: wideLabel ? '100%' : 'auto',
                flexGrow: wideLabel ? 0 : 1,
                flexShrink: wideLabel ? 0 : 1,
                flexBasis: wideLabel ? 'auto' : 0,
              },
            ]}
          >
            <JournalPressable style={s.action} onPress={onBack} accessibilityRole="button" accessibilityLabel="Назад">
              <Ionicons name="chevron-back" size={22} color={p.accent.primaryText} />
            </JournalPressable>
            <View style={[s.folder, { backgroundColor: p.bg.muted }]}>
              <Text
                variant="bodyEmph"
                color={p.text.primary}
                numberOfLines={wideLabel ? undefined : 1}
                allowFontScaling={false}
                style={{ fontSize: 15 * fontScale, lineHeight: 22 * fontScale }}
              >
                {search ? 'Поиск по каталогу' : folderName}
              </Text>
              {!!countLabel && (
                <Text
                  variant="caption"
                  color={p.text.secondary}
                  allowFontScaling={false}
                  style={{ fontSize: 11 * fontScale, lineHeight: 14 * fontScale }}
                >
                  {countLabel}
                </Text>
              )}
            </View>
          </View>
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
              accessibilityLabel="Поиск услуг"
              accessibilityState={{ expanded: searching }}
            >
              <Ionicons name="search" size={20} color={searching ? p.accent.primaryText : p.text.primary} />
            </JournalPressable>
            <ServicesMenu label="Действия с услугами" icon="ellipsis-horizontal" items={actions} />
            <ServicesMenu label="Добавить услугу или папку" icon="add" primary items={createItems} />
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
              const height = event.nativeEvent.layout.height;
              setSearchHeight((previous) => (previous === height ? previous : height));
            }}
          >
            <JournalSearchInput
              active={searching}
              value={search}
              onChange={onSearchChange}
              onFocusChange={ignoreFocus}
              onCancel={() => setSearching(false)}
              placeholder="Поиск во всех папках"
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
  dock: {
    borderRadius: 28,
    borderCurve: 'continuous',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 18,
    elevation: 5,
  },
  commandRow: { flexDirection: 'row', alignItems: 'center', padding: 6, rowGap: 4 },
  identity: { flexDirection: 'row', alignItems: 'center', minWidth: 0, flexShrink: 1 },
  folder: {
    flex: 1,
    minWidth: 0,
    minHeight: touch,
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 4,
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  action: { width: touch, minHeight: touch, borderRadius: touch / 2, alignItems: 'center', justifyContent: 'center' },
  reveal: { overflow: 'hidden', borderBottomLeftRadius: 28, borderBottomRightRadius: 28 },
  searchContent: { position: 'absolute', left: 6, right: 6, top: 0, paddingBottom: 6, flexDirection: 'row' },
});
