/**
 * AudiencePicker — «Кому показывать» for a regulation (#54).
 *
 * Lets a manager target a regulation at either:
 *   • «Для всех сотрудников» (targetAll = true, the default), or
 *   • a hand-picked set of employees (targetAll = false + targetUserIds[]).
 *
 * The selected employees are the ones who must «ознакомиться» — the backend
 * computes the ack audience from this. Only meaningful for type='regulation';
 * the editor renders it only in that mode.
 *
 * Employees come from `usersApi.getAll()` under the SAME `['users']` query key
 * the login prefetch warms, so the picker opens populated, cache-first. We show
 * active, non-dismissed staff (owner/superadmin excluded — they bypass gates).
 * Android-safe — RN + shared <BottomSheet/> only.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../BottomSheet';
import SearchInput from '../SearchInput';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { usersApi } from '../../api/services';
import { haptic } from '../../platform/haptics';
import { UserRole } from '../../../../shared/types';
import type { User } from '../../../../shared/types';

export interface AudienceValue {
  targetAll: boolean;
  targetUserIds: string[];
}

interface AudiencePickerProps {
  value: AudienceValue;
  onChange: (next: AudienceValue) => void;
}

/** Active, non-dismissed staff; owners (superadmin) excluded. */
function selectableEmployees(users: User[] | undefined): User[] {
  if (!users) return [];
  return users
    .filter((u) => u.isActive && !u.dismissedAt && !u.purgedAt && u.role !== UserRole.SUPERADMIN)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
}

export default function AudiencePicker({ value, onChange }: AudiencePickerProps) {
  const palette = useColors();
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const { data: users } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => (await usersApi.getAll()).data,
    staleTime: 5 * 60_000,
  });

  const employees = React.useMemo(() => selectableEmployees(users), [users]);
  const selectedIds = React.useMemo(() => new Set(value.targetUserIds), [value.targetUserIds]);

  const selectedEmployees = React.useMemo(
    () => employees.filter((u) => selectedIds.has(u.id)),
    [employees, selectedIds],
  );

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((u) => u.fullName.toLowerCase().includes(q) || (u.phone ?? '').includes(q));
  }, [employees, search]);

  const setMode = (targetAll: boolean) => {
    haptic('select');
    onChange({ targetAll, targetUserIds: value.targetUserIds });
  };

  const toggleUser = (id: string) => {
    haptic('tap');
    const next = new Set(value.targetUserIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange({ targetAll: false, targetUserIds: Array.from(next) });
  };

  const removeUser = (id: string) => {
    haptic('tap');
    onChange({ targetAll: false, targetUserIds: value.targetUserIds.filter((x) => x !== id) });
  };

  return (
    <View>
      {/* Mode segment */}
      <View style={[styles.segment, { backgroundColor: palette.bg.muted }]}>
        {([true, false] as const).map((all) => {
          const active = value.targetAll === all;
          return (
            <Pressable
              key={String(all)}
              onPress={() => setMode(all)}
              style={[styles.segmentItem, active && { backgroundColor: palette.bg.card }]}
            >
              <Ionicons
                name={all ? 'people-outline' : 'person-outline'}
                size={15}
                color={active ? palette.text.primary : palette.text.secondary}
              />
              <Text
                variant="footnote"
                style={{ color: active ? palette.text.primary : palette.text.secondary, fontWeight: '600' }}
              >
                {all ? 'Для всех' : 'Выбрать'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {value.targetAll ? (
        <Text variant="caption" style={[styles.hint, { color: palette.text.tertiary }]}>
          Регламент увидят все сотрудники — каждый должен будет ознакомиться.
        </Text>
      ) : (
        <View style={{ marginTop: spacing[2.5] }}>
          <Pressable
            onPress={() => {
              haptic('tap');
              setSearch('');
              setPickerOpen(true);
            }}
            style={({ pressed }) => [
              styles.selectBtn,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Выбрать сотрудников"
          >
            <View style={[styles.selectIcon, { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons name="person-add-outline" size={18} color={palette.accent.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text variant="bodyEmph" style={{ color: palette.text.primary }}>
                {selectedEmployees.length > 0 ? `Выбрано: ${selectedEmployees.length}` : 'Выбрать сотрудников'}
              </Text>
              <Text variant="caption" numberOfLines={1} style={{ color: palette.text.tertiary }}>
                {selectedEmployees.length > 0
                  ? selectedEmployees.map((u) => u.fullName).join(', ')
                  : 'Кто должен ознакомиться'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
          </Pressable>

          {/* Selected chips with quick-remove */}
          {selectedEmployees.length > 0 ? (
            <View style={styles.chips}>
              {selectedEmployees.map((u) => (
                <Pressable
                  key={u.id}
                  onPress={() => removeUser(u.id)}
                  style={[styles.chip, { backgroundColor: palette.accent.primarySoft }]}
                >
                  <Text variant="caption" style={{ color: palette.accent.primary, fontWeight: '600' }}>
                    {u.fullName}
                  </Text>
                  <Ionicons name="close" size={13} color={palette.accent.primary} />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      )}

      {/* Multi-select sheet */}
      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Кому показывать" heightRatio={0.85}>
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск сотрудника" />
        {filtered.length === 0 ? (
          <Text
            variant="footnote"
            style={{ color: palette.text.tertiary, paddingVertical: spacing[4], textAlign: 'center' }}
          >
            {employees.length === 0 ? 'Нет доступных сотрудников.' : 'Никого не найдено.'}
          </Text>
        ) : (
          <View style={{ gap: spacing[1.5] }}>
            {filtered.map((u) => {
              const checked = selectedIds.has(u.id);
              return (
                <Pressable
                  key={u.id}
                  onPress={() => toggleUser(u.id)}
                  style={({ pressed }) => [
                    styles.userRow,
                    {
                      backgroundColor: checked ? palette.accent.primarySoft : palette.bg.card,
                      borderColor: checked ? palette.accent.primary : palette.border.subtle,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="bodyEmph" numberOfLines={1} style={{ color: palette.text.primary }}>
                      {u.fullName}
                    </Text>
                    {u.phone ? (
                      <Text variant="caption" style={{ color: palette.text.tertiary }}>
                        {u.phone}
                      </Text>
                    ) : null}
                  </View>
                  <Ionicons
                    name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={checked ? palette.accent.primary : palette.text.tertiary}
                  />
                </Pressable>
              );
            })}
          </View>
        )}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', borderRadius: borderRadius.lg, padding: 3, gap: 3 },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
  },
  hint: { marginTop: spacing[2], marginLeft: spacing[1] },

  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  selectIcon: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2.5] },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
  },

  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
  },
});
