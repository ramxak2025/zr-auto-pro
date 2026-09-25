/**
 * ReportFilterSheet — сущностный фильтр отчёта (мастера / сотрудники /
 * поставщики / филиалы): мультивыбор с поиском в нижней шторке.
 *
 * Список приходит из GET /reports/builder/filters/:kind (уже с подписями вроде
 * «уволен 12.08»), поиск — локальный по label/sublabel. Черновик выбора живёт
 * в шторке и уходит наверх одним `onApply` по кнопке — так смена фильтра не
 * дёргает отчёт на каждый тап. Пустой выбор = «Все» (по умолчанию).
 *
 * TextInput живёт внутри BottomSheet, тело которого — KeyboardAwareScrollView
 * (правило клавиатуры проекта): поле не уезжает под клавиатуру ни на iOS, ни
 * на Android.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../../components/BottomSheet';
import { Button } from '../../components/Button';
import { ListSkeleton } from '../../components/Skeleton';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { borderRadius, fontSize, spacing } from '../../theme';
import type { ReportFilterOption } from '../../../../shared/types';

interface ReportFilterSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Подпись фильтра из каталога («Мастера»). */
  label: string;
  options: ReportFilterOption[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  selectedIds: string[];
  onApply: (ids: string[]) => void;
}

function matches(option: ReportFilterOption, needle: string): boolean {
  if (!needle) return true;
  const hay = `${option.label} ${option.sublabel ?? ''}`.toLowerCase();
  return hay.includes(needle);
}

export default function ReportFilterSheet({
  visible,
  onClose,
  label,
  options,
  loading,
  error,
  onRetry,
  selectedIds,
  onApply,
}: ReportFilterSheetProps) {
  const palette = useColors();
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selectedIds));
  const [search, setSearch] = useState('');

  // Каждое открытие начинает с текущего применённого выбора и пустого поиска.
  useEffect(() => {
    if (visible) {
      setDraft(new Set(selectedIds));
      setSearch('');
    }
  }, [visible, selectedIds]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => (options ?? []).filter((o) => matches(o, needle)), [options, needle]);
  const allSelected = draft.size === 0;

  const toggle = (id: string) => {
    haptic('select');
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apply = () => {
    // Порядок — как в списке сервера, чтобы чипы и подпись PDF были стабильны.
    const ordered = (options ?? []).map((o) => o.id).filter((id) => draft.has(id));
    onApply(ordered);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={label} heightRatio={0.82}>
      <View style={[styles.searchWrap, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name="search-outline" size={16} color={palette.text.tertiary} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Поиск"
          placeholderTextColor={palette.text.tertiary}
          style={[styles.searchInput, { color: palette.text.primary }]}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel={`Поиск: ${label}`}
        />
      </View>

      {loading && !options ? (
        <ListSkeleton count={5} />
      ) : error && !options ? (
        <View style={styles.stateWrap}>
          <Text variant="footnote" color={palette.text.secondary} style={styles.stateText}>
            Не удалось загрузить список
          </Text>
          <Button title="Повторить" variant="secondary" size="sm" fullWidth={false} onPress={onRetry} />
        </View>
      ) : (
        <View style={[styles.list, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          {!needle && (
            <TouchableOpacity
              style={[styles.row, styles.rowDivider, { borderBottomColor: palette.border.subtle }]}
              onPress={() => {
                haptic('select');
                setDraft(new Set());
              }}
              activeOpacity={0.6}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: allSelected }}
            >
              <View style={styles.rowText}>
                <Text variant="bodyEmph" color={palette.text.primary}>
                  Все
                </Text>
                <Text variant="footnote" color={palette.text.tertiary}>
                  {options ? `${options.length} в списке` : 'без ограничения'}
                </Text>
              </View>
              <Ionicons
                name={allSelected ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={allSelected ? palette.accent.primary : palette.border.strong}
              />
            </TouchableOpacity>
          )}
          {filtered.map((option, index) => {
            const checked = draft.has(option.id);
            const last = index === filtered.length - 1;
            return (
              <TouchableOpacity
                key={option.id}
                style={[styles.row, !last && [styles.rowDivider, { borderBottomColor: palette.border.subtle }]]}
                onPress={() => toggle(option.id)}
                activeOpacity={0.6}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={option.label}
              >
                <View style={styles.rowText}>
                  <Text variant="body" color={palette.text.primary} numberOfLines={1}>
                    {option.label}
                  </Text>
                  {option.sublabel ? (
                    <Text variant="footnote" color={palette.text.tertiary} numberOfLines={1}>
                      {option.sublabel}
                    </Text>
                  ) : null}
                </View>
                <Ionicons
                  name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={checked ? palette.accent.primary : palette.border.strong}
                />
              </TouchableOpacity>
            );
          })}
          {filtered.length === 0 && (
            <View style={styles.row}>
              <Text variant="footnote" color={palette.text.tertiary}>
                {needle ? 'Ничего не найдено' : 'Список пуст'}
              </Text>
            </View>
          )}
        </View>
      )}

      <View style={styles.footer}>
        <Button
          title={allSelected ? 'Показать все' : `Показать: ${draft.size}`}
          onPress={apply}
          disabled={!options && !error}
        />
        {!allSelected && (
          <TouchableOpacity
            onPress={() => {
              haptic('tap');
              setDraft(new Set());
            }}
            style={styles.resetBtn}
            accessibilityRole="button"
          >
            <Text variant="footnote" color={palette.text.secondary}>
              Сбросить выбор
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.lg,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
  },
  list: {
    marginHorizontal: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    minHeight: 52,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 1 },
  stateWrap: {
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[6],
  },
  stateText: { textAlign: 'center' },
  footer: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    gap: spacing[2],
    alignItems: 'center',
  },
  resetBtn: { paddingVertical: spacing[2] },
});
