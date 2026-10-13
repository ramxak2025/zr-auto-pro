import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  Platform,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, KeyboardAwareScrollView, KeyboardProvider } from 'react-native-keyboard-controller';
import { colors } from '../../theme';
import { Text, textVariantStyles } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import DateTimePickerModal from '../../components/DateTimePickerModal';
import { CompactSearchInput as SearchInput } from '../../components/CompactScreenHeader';
import type { User } from '../../../../shared/types';
import {
  emptyJournalFilters,
  journalDateLabel,
  journalDay,
  journalFilterError,
  journalPeriod,
  journalPickerDate,
  type JournalFilters,
} from './filters';

interface Props {
  visible: boolean;
  applied: JournalFilters;
  timeZone: string;
  users: User[];
  usersLoading: boolean;
  usersError: boolean;
  retryUsers: () => void;
  onClose: () => void;
  onApply: (filters: JournalFilters) => void;
}

export default function JournalFiltersSheet(props: Props) {
  const p = useColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(props.applied);
  const [employeePicker, setEmployeePicker] = useState(false);
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [datePicker, setDatePicker] = useState<'dateFrom' | 'dateTo' | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (props.visible) {
      setDraft({ ...props.applied });
      setEmployeePicker(false);
      setEmployeeSearch('');
      setDatePicker(null);
      setError(null);
      setAdvanced(
        Boolean(
          props.applied.amountFrom ||
          props.applied.amountTo ||
          props.applied.hasDiscount ||
          props.applied.isReturned ||
          props.applied.isDeferred,
        ),
      );
    }
  }, [props.visible, props.applied]);
  const patch = (values: Partial<JournalFilters>) => {
    setDraft((current) => ({ ...current, ...values }));
    setError(null);
  };
  const close = () => {
    Keyboard.dismiss();
    if (employeePicker) setEmployeePicker(false);
    else props.onClose();
  };
  const filteredUsers = props.users.filter((user) =>
    user.fullName?.toLocaleLowerCase('ru').includes(employeeSearch.trim().toLocaleLowerCase('ru')),
  );
  const rowStyle = [s.row, { borderBottomColor: p.border.subtle }];
  const chooseEmployee = (masterId: string) => {
    patch({ masterId });
    setEmployeePicker(false);
    Keyboard.dismiss();
  };

  const advancedSummary = [
    (draft.amountFrom || draft.amountTo) && `Сумма: ${draft.amountFrom || 'любая'} — ${draft.amountTo || 'любая'} ₽`,
    draft.hasDiscount && 'Со скидкой',
    draft.isReturned && 'Возвраты клиентов',
    draft.isDeferred && 'Отложенные',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Modal
      visible={props.visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <KeyboardProvider>
        <Pressable style={s.backdrop} onPress={close} accessibilityRole="button" accessibilityLabel="Закрыть фильтры" />
        <KeyboardAvoidingView behavior="padding" style={s.keyboardHost} pointerEvents="box-none">
          <View style={[s.overlay, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
            <View
              style={[s.container, { backgroundColor: p.bg.canvas, paddingBottom: insets.bottom }]}
              accessibilityViewIsModal
            >
              <View style={[s.header, { borderBottomColor: p.border.subtle }]}>
                <TouchableOpacity
                  onPress={close}
                  style={s.headerAction}
                  accessibilityRole="button"
                  accessibilityLabel={employeePicker ? 'Назад к фильтрам' : 'Отменить изменения фильтров'}
                >
                  {employeePicker ? (
                    <Ionicons name="chevron-back" size={24} color={p.accent.primary} />
                  ) : (
                    <Text color={p.accent.primary}>Отмена</Text>
                  )}
                </TouchableOpacity>
                <Text variant="title3" color={p.text.primary} style={s.headerTitle}>
                  {employeePicker ? 'По сотруднику' : 'Фильтры чеков'}
                </Text>
                <View style={s.headerAction} />
              </View>
              <KeyboardAwareScrollView
                style={s.scroll}
                contentContainerStyle={s.content}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                bottomOffset={16}
              >
                {employeePicker ? (
                  <>
                    <SearchInput value={employeeSearch} onChange={setEmployeeSearch} placeholder="Найти сотрудника" />
                    <TouchableOpacity
                      style={rowStyle}
                      onPress={() => chooseEmployee('')}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: !draft.masterId }}
                    >
                      <Text color={p.text.primary} style={s.flex}>
                        Все сотрудники
                      </Text>
                      {!draft.masterId && <Ionicons name="checkmark" size={22} color={p.accent.primary} />}
                    </TouchableOpacity>
                    {props.usersLoading && <ActivityIndicator color={p.accent.primary} style={s.loading} />}
                    {props.usersError && (
                      <View style={s.message}>
                        <Text color={p.text.secondary}>Не удалось загрузить сотрудников.</Text>
                        <TouchableOpacity onPress={props.retryUsers} style={s.row}>
                          <Text color={p.accent.primary}>Повторить</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                    {!props.usersLoading && !props.usersError && filteredUsers.length === 0 && (
                      <Text color={p.text.secondary} style={s.message}>
                        Сотрудники не найдены
                      </Text>
                    )}
                    {filteredUsers.map((user) => (
                      <TouchableOpacity
                        key={user.id}
                        style={rowStyle}
                        onPress={() => chooseEmployee(user.id)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: draft.masterId === user.id }}
                      >
                        <Text color={p.text.primary} style={s.flex}>
                          {user.fullName}
                        </Text>
                        {draft.masterId === user.id && <Ionicons name="checkmark" size={22} color={p.accent.primary} />}
                      </TouchableOpacity>
                    ))}
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      style={rowStyle}
                      onPress={() => {
                        setEmployeeSearch('');
                        setEmployeePicker(true);
                      }}
                      accessibilityRole="button"
                    >
                      <Ionicons name="person-outline" size={20} color={p.text.secondary} />
                      <View style={s.flex}>
                        <Text color={p.text.primary}>По сотруднику</Text>
                        <Text variant="footnote" color={p.text.secondary}>
                          {draft.masterId
                            ? props.users.find((user) => user.id === draft.masterId)?.fullName || 'Сотрудник выбран'
                            : 'Все сотрудники'}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={p.text.secondary} />
                    </TouchableOpacity>
                    <Text variant="footnote" color={p.text.secondary} style={s.sectionTitle}>
                      Период
                    </Text>
                    <View style={s.presets}>
                      {(['today', 'week', 'month'] as const).map((key, index) => (
                        <TouchableOpacity
                          key={key}
                          style={[s.preset, { backgroundColor: p.bg.muted }]}
                          onPress={() => patch(journalPeriod(key, props.timeZone))}
                          accessibilityRole="button"
                        >
                          <Text variant="footnote" color={p.accent.primary}>
                            {['Сегодня', '7 дней', 'Этот месяц'][index]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    {(['dateFrom', 'dateTo'] as const).map((key, index) => (
                      <View key={key} style={rowStyle}>
                        <TouchableOpacity
                          style={[s.dateAction, s.flex]}
                          onPress={() => setDatePicker(key)}
                          accessibilityRole="button"
                          accessibilityLabel={`${index === 0 ? 'Дата от' : 'Дата до'}: ${draft[key] ? journalDateLabel(draft[key]) : 'Любая дата'}`}
                        >
                          <Text color={p.text.primary}>{index === 0 ? 'От' : 'До'}</Text>
                          <Text color={draft[key] ? p.accent.primary : p.text.secondary}>
                            {draft[key] ? journalDateLabel(draft[key]) : 'Любая дата'}
                          </Text>
                        </TouchableOpacity>
                        {draft[key] && (
                          <TouchableOpacity
                            style={s.clear}
                            onPress={() => patch({ [key]: '' })}
                            accessibilityRole="button"
                            accessibilityLabel={`Очистить дату ${index === 0 ? 'от' : 'до'}`}
                          >
                            <Ionicons name="close-circle" size={20} color={p.text.secondary} />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                    <Text variant="footnote" color={p.text.secondary} style={s.hint}>
                      Оба дня включены. Часовой пояс автосервиса.
                    </Text>
                    <TouchableOpacity
                      style={[rowStyle, s.advancedRow]}
                      onPress={() => setAdvanced(!advanced)}
                      accessibilityRole="button"
                      accessibilityLabel="Дополнительно: сумма и тип чека"
                      accessibilityState={{ expanded: advanced }}
                    >
                      <View style={s.flex}>
                        <Text color={p.text.primary}>Дополнительно</Text>
                        <Text variant="footnote" color={p.text.secondary}>
                          {advancedSummary || 'Сумма и тип чека'}
                        </Text>
                      </View>
                      <Ionicons name={advanced ? 'chevron-up' : 'chevron-down'} size={18} color={p.text.secondary} />
                    </TouchableOpacity>
                    {advanced && (
                      <>
                        <Text variant="footnote" color={p.text.secondary} style={s.sectionTitle}>
                          Сумма чека
                        </Text>
                        <Text variant="footnote" color={p.text.secondary}>
                          Итог после скидки, ₽
                        </Text>
                        <View style={s.amountRow}>
                          {(['amountFrom', 'amountTo'] as const).map((key, index) => (
                            <View style={s.flex} key={key}>
                              <Text variant="footnote" color={p.text.secondary} style={s.inputLabel}>
                                {index === 0 ? 'От' : 'До'}
                              </Text>
                              <TextInput
                                value={draft[key]}
                                onChangeText={(value) => patch({ [key]: value })}
                                keyboardType="decimal-pad"
                                placeholder="Без границы"
                                placeholderTextColor={p.text.secondary}
                                accessibilityLabel={`Сумма ${index === 0 ? 'от' : 'до'}, рубли`}
                                style={[
                                  textVariantStyles.body,
                                  s.input,
                                  { backgroundColor: p.bg.card, color: p.text.primary, borderColor: p.border.subtle },
                                ]}
                              />
                            </View>
                          ))}
                        </View>
                        <Text variant="footnote" color={p.text.secondary} style={s.sectionTitle}>
                          Показать только
                        </Text>
                        {(['hasDiscount', 'isReturned', 'isDeferred'] as const).map((key, index) => (
                          <View key={key} style={rowStyle}>
                            <Text color={p.text.primary} style={s.flex}>
                              {['Со скидкой', 'Возвраты клиентов', 'Отложенные'][index]}
                            </Text>
                            <Switch
                              value={draft[key]}
                              onValueChange={(value) => patch({ [key]: value })}
                              trackColor={{ true: p.accent.primary }}
                              accessibilityLabel={
                                ['Только чеки со скидкой', 'Только возвраты клиентов', 'Только отложенные'][index]
                              }
                            />
                          </View>
                        ))}
                      </>
                    )}
                  </>
                )}
              </KeyboardAwareScrollView>
              {!employeePicker && (
                <View style={[s.footer, { borderTopColor: p.border.subtle, backgroundColor: p.bg.canvas }]}>
                  {error && (
                    <Text color={colors.red[600]} accessibilityRole="alert" style={s.message}>
                      {error}
                    </Text>
                  )}
                  <View style={s.footerActions}>
                    <TouchableOpacity
                      style={s.reset}
                      onPress={() => {
                        setDraft(emptyJournalFilters());
                        setError(null);
                      }}
                      accessibilityRole="button"
                    >
                      <Text color={p.accent.primary}>Сбросить</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.apply, { backgroundColor: p.accent.primary }]}
                      onPress={() => {
                        const issue = journalFilterError(draft);
                        setError(issue);
                        if (!issue) {
                          Keyboard.dismiss();
                          props.onApply({ ...draft });
                          props.onClose();
                        }
                      }}
                      accessibilityRole="button"
                    >
                      <Text variant="callout" color={p.text.inverse}>
                        Применить
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </View>
        </KeyboardAvoidingView>
      </KeyboardProvider>
      <DateTimePickerModal
        visible={props.visible && datePicker !== null}
        value={journalPickerDate(
          (datePicker && draft[datePicker]) || journalDay(new Date(), props.timeZone),
          props.timeZone,
        )}
        timeZone={props.timeZone}
        mode="date"
        onCancel={() => setDatePicker(null)}
        onConfirm={(value) => {
          if (datePicker) patch({ [datePicker]: journalDay(value, props.timeZone) });
          setDatePicker(null);
        }}
      />
    </Modal>
  );
}

const touchHeight = Platform.OS === 'android' ? 48 : 44;
const s = StyleSheet.create({
  keyboardHost: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0, 0, 0, 0.28)' },
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  container: {
    width: '100%',
    maxWidth: 600,
    maxHeight: 620,
    flexShrink: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
  },
  scroll: { flexGrow: 0, flexShrink: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
  },
  headerAction: { minWidth: 72, minHeight: touchHeight, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', paddingVertical: 8 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8 },
  flex: { flex: 1 },
  row: {
    minHeight: Platform.OS === 'android' ? 52 : 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  sectionTitle: { marginTop: 16, marginBottom: 8 },
  advancedRow: { marginTop: 8 },
  presets: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  preset: { minHeight: touchHeight, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8 },
  dateAction: {
    minHeight: touchHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  clear: { width: touchHeight, height: touchHeight, alignItems: 'center', justifyContent: 'center' },
  hint: { marginTop: 8 },
  amountRow: { flexDirection: 'row', gap: 12 },
  inputLabel: { marginTop: 12, marginBottom: 6 },
  input: { minHeight: touchHeight, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  footer: { gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  footerActions: { flexDirection: 'row', gap: 12 },
  reset: { minHeight: touchHeight, paddingHorizontal: 8, justifyContent: 'center' },
  apply: {
    flex: 1,
    minHeight: touchHeight,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  loading: { margin: 24 },
  message: { marginTop: 16 },
});
