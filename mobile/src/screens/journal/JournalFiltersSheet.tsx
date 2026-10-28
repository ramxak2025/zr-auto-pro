import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Platform, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { colors } from '../../theme';
import { Text, textVariantStyles } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import DateTimePickerModal from '../../components/DateTimePickerModal';
import { JournalPressable as TouchableOpacity } from './JournalMotion';
import type { User } from '../../../../shared/types';
import JournalModal, { JournalFilterPage } from './JournalModal';
import {
  JournalFilterHeader,
  JournalFilterSummary,
  JournalFilterGroup,
  JournalFilterSearch,
  journalFilterStyles as s,
} from './JournalFilterControls';
import {
  journalFilterCount,
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
type Page = 'overview' | 'period' | 'employee' | 'amount';

export default function JournalFiltersSheet(props: Props) {
  const p = useColors();
  const { fontScale } = useWindowDimensions();
  const [draft, setDraft] = useState(props.applied);
  const [page, setPage] = useState<Page>('overview');
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [datePicker, setDatePicker] = useState<'dateFrom' | 'dateTo' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wasVisible = useRef(false);
  useEffect(() => {
    if (props.visible && !wasVisible.current) {
      setDraft({ ...props.applied });
      setPage('overview');
      setEmployeeSearch('');
      setDatePicker(null);
      setError(null);
    }
    wasVisible.current = props.visible;
  }, [props.visible, props.applied]);
  const patch = (values: Partial<JournalFilters>) => {
    setDraft((current) => ({ ...current, ...values }));
    setError(null);
  };
  const back = () => {
    Keyboard.dismiss();
    setPage('overview');
  };
  const close = () => {
    Keyboard.dismiss();
    if (datePicker) setDatePicker(null);
    else if (page !== 'overview') setPage('overview');
    else props.onClose();
  };
  const navigate = (next: Page) => {
    Keyboard.dismiss();
    setPage(next);
  };
  const filteredUsers = props.users.filter((user) =>
    user.fullName?.toLocaleLowerCase('ru').includes(employeeSearch.trim().toLocaleLowerCase('ru')),
  );
  const rowStyle = [s.row, { borderBottomColor: p.border.subtle }];
  const dateSummary =
    draft.dateFrom || draft.dateTo
      ? `${draft.dateFrom ? journalDateLabel(draft.dateFrom) : 'Любая дата'} — ${draft.dateTo ? journalDateLabel(draft.dateTo) : 'Любая дата'}`
      : 'За всё время';
  const amountSummary =
    draft.amountFrom || draft.amountTo
      ? `${draft.amountFrom || 'Без минимума'} — ${draft.amountTo || 'без максимума'} ₽`
      : 'Любая сумма';
  const employeeSummary = draft.masterId
    ? props.users.find((user) => user.id === draft.masterId)?.fullName || 'Сотрудник выбран'
    : 'Все сотрудники';
  return (
    <JournalModal visible={props.visible} onRequestClose={close} onDismiss={props.onClose}>
      <JournalFilterHeader
        title={{ overview: 'Фильтры', period: 'Период', employee: 'По сотруднику', amount: 'Сумма чека' }[page]}
        detail={page !== 'overview'}
        onBack={back}
        onClose={props.onClose}
      />
      <KeyboardAwareScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        bottomOffset={16}
      >
        <JournalFilterPage page={page}>
          {page === 'overview' && (
            <>
              <JournalFilterGroup>
                <JournalFilterSummary
                  active={Boolean(draft.dateFrom || draft.dateTo)}
                  title="Период"
                  value={dateSummary}
                  icon="calendar-outline"
                  onPress={() => navigate('period')}
                />
                <JournalFilterSummary
                  active={Boolean(draft.masterId)}
                  title="По сотруднику"
                  value={employeeSummary}
                  icon="person-outline"
                  onPress={() => {
                    setEmployeeSearch('');
                    navigate('employee');
                  }}
                />
                <JournalFilterSummary
                  active={Boolean(draft.amountFrom || draft.amountTo)}
                  last
                  title="Сумма чека"
                  value={amountSummary}
                  icon="cash-outline"
                  onPress={() => navigate('amount')}
                />
              </JournalFilterGroup>
              <Text variant="footnote" color={p.text.secondary} style={s.sectionTitle}>
                Показать только
              </Text>
              <View style={local.flagGroup}>
                {(['hasDiscount', 'isReturned', 'isDeferred'] as const).map((key, index) => (
                  <TouchableOpacity
                    key={key}
                    style={[local.flag, { backgroundColor: draft[key] ? p.accent.primarySoft : p.bg.muted }]}
                    onPress={() => patch({ [key]: !draft[key] })}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: draft[key] }}
                    accessibilityLabel={
                      ['Только чеки со скидкой', 'Только возвраты клиентов', 'Только отложенные'][index]
                    }
                  >
                    <Ionicons
                      name={draft[key] ? 'checkmark-circle' : 'ellipse-outline'}
                      size={17}
                      color={draft[key] ? p.accent.primaryText : p.text.secondary}
                    />
                    <Text
                      variant="footnote"
                      color={draft[key] ? p.accent.primaryText : p.text.primary}
                      style={local.flagLabel}
                    >
                      {['Со скидкой', 'Возвраты', 'Отложенные'][index]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {page === 'period' && (
            <>
              <View style={s.presets}>
                {(['today', 'week', 'month'] as const).map((key, index) => {
                  const period = journalPeriod(key, props.timeZone);
                  const selected = draft.dateFrom === period.dateFrom && draft.dateTo === period.dateTo;
                  return (
                    <TouchableOpacity
                      key={key}
                      style={[s.preset, { backgroundColor: selected ? p.accent.primarySoft : p.bg.muted }]}
                      onPress={() => patch(period)}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text variant="footnote" color={selected ? p.accent.primaryText : p.text.primary}>
                        {['Сегодня', '7 дней', 'Этот месяц'][index]}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={s.dateFields}>
                {(['dateFrom', 'dateTo'] as const).map((key, index) => (
                  <View key={key} style={[s.dateField, { backgroundColor: p.bg.card }]}>
                    <TouchableOpacity
                      style={[s.dateAction, s.flex]}
                      onPress={() => setDatePicker(key)}
                      accessibilityRole="button"
                      accessibilityLabel={`${index === 0 ? 'Дата от' : 'Дата до'}: ${draft[key] ? journalDateLabel(draft[key]) : 'Любая дата'}`}
                    >
                      <Text variant="footnote" color={p.text.secondary}>
                        {index === 0 ? 'От' : 'До'}
                      </Text>
                      <Text color={draft[key] ? p.accent.primaryText : p.text.primary}>
                        {draft[key] ? journalDateLabel(draft[key]) : 'Любая дата'}
                      </Text>
                    </TouchableOpacity>
                    {!!draft[key] && (
                      <TouchableOpacity
                        style={s.clear}
                        onPress={() => patch({ [key]: '' })}
                        accessibilityRole="button"
                        accessibilityLabel={`Очистить дату ${index === 0 ? 'от' : 'до'}`}
                      >
                        <Ionicons name="close-circle" size={22} color={p.text.secondary} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
              <Text variant="footnote" color={p.text.secondary} style={s.hint}>
                Оба дня включены. Часовой пояс автосервиса.
              </Text>
            </>
          )}
          {page === 'employee' && (
            <>
              <JournalFilterSearch value={employeeSearch} onChange={setEmployeeSearch} />
              <TouchableOpacity
                style={rowStyle}
                accessibilityRole="radio"
                accessibilityState={{ selected: !draft.masterId }}
                onPress={() => {
                  patch({ masterId: '' });
                  back();
                }}
              >
                <Text color={p.text.primary} style={s.flex}>
                  Все сотрудники
                </Text>
                {!draft.masterId && <Ionicons name="checkmark" size={22} color={p.accent.primaryText} />}
              </TouchableOpacity>
              {props.usersLoading && <ActivityIndicator color={p.accent.primary} style={s.loading} />}
              {props.usersError && (
                <View style={s.message}>
                  <Text color={p.text.secondary}>Не удалось загрузить сотрудников.</Text>
                  <TouchableOpacity onPress={props.retryUsers} style={s.row} accessibilityRole="button">
                    <Text color={p.accent.primaryText}>Повторить</Text>
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
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draft.masterId === user.id }}
                  onPress={() => {
                    patch({ masterId: user.id });
                    back();
                  }}
                >
                  <Text color={p.text.primary} style={s.flex}>
                    {user.fullName}
                  </Text>
                  {draft.masterId === user.id && <Ionicons name="checkmark" size={22} color={p.accent.primaryText} />}
                </TouchableOpacity>
              ))}
            </>
          )}
          {page === 'amount' && (
            <>
              <Text variant="footnote" color={p.text.secondary} style={s.hint}>
                Итог после скидки, ₽
              </Text>
              <View style={[s.amountRow, fontScale > 1.3 && local.stack]}>
                {(['amountFrom', 'amountTo'] as const).map((key, index) => (
                  <View style={fontScale > 1.3 ? local.stackedAmountField : s.flex} key={key}>
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
                      selectionColor={p.accent.primary}
                      style={[
                        textVariantStyles.callout,
                        s.input,
                        { backgroundColor: p.bg.card, color: p.text.primary },
                      ]}
                    />
                  </View>
                ))}
              </View>
            </>
          )}
        </JournalFilterPage>
      </KeyboardAwareScrollView>
      <View style={[s.footer, { backgroundColor: p.bg.elevated }]}>
        {error && (
          <Text color={colors.red[600]} accessibilityRole="alert" style={s.message}>
            {error}
          </Text>
        )}
        {page === 'overview' ? (
          <View style={[s.footerActions, fontScale > 1.3 && local.footerStack]}>
            <TouchableOpacity
              style={s.reset}
              onPress={() => {
                setDraft(emptyJournalFilters());
                setError(null);
              }}
              accessibilityRole="button"
            >
              <Text color={p.accent.primaryText}>Сбросить</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.apply, { backgroundColor: p.accent.primary }]}
              accessibilityRole="button"
              onPress={() => {
                const issue = journalFilterError(draft);
                setError(issue);
                if (!issue) {
                  Keyboard.dismiss();
                  props.onApply({ ...draft });
                  props.onClose();
                }
              }}
            >
              <Text variant="callout" color={p.text.inverse}>
                {journalFilterCount(draft) ? `Применить · ${journalFilterCount(draft)}` : 'Применить'}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[s.apply, { backgroundColor: p.bg.muted }]}
            accessibilityRole="button"
            onPress={() => {
              const issue = journalFilterError(draft);
              setError(issue);
              if (!issue) back();
            }}
          >
            <Text variant="callout" color={p.accent.primaryText}>
              Готово
            </Text>
          </TouchableOpacity>
        )}
      </View>
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
    </JournalModal>
  );
}
const local = StyleSheet.create({
  stack: { flexDirection: 'column' },
  // Vertical fields retain their label/input intrinsic height; flex: 1 gives
  // a zero basis inside the content-sized, measured sheet page.
  stackedAmountField: { minWidth: 0, alignSelf: 'stretch' },
  flagGroup: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  flag: {
    flexGrow: 1,
    maxWidth: '100%',
    minHeight: Platform.OS === 'android' ? 48 : 44,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 22,
  },
  flagLabel: { flexShrink: 1 },
  footerStack: { flexDirection: 'column-reverse', alignItems: 'stretch', gap: 4 },
});
