import React, { useEffect, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { JournalPressable as TouchableOpacity } from './JournalMotion';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import DateTimePickerModal from '../../components/DateTimePickerModal';
import type { JournalDoc } from '../../../../shared/types';
import JournalModal, { JournalFilterPage } from './JournalModal';
import {
  JournalFilterHeader,
  JournalFilterSummary,
  JournalFilterGroup,
  journalFilterStyles as s,
} from './JournalFilterControls';

type Kind = JournalDoc['kind'];
/** Warehouse filters keep their existing independent state and immediate-apply contract. */
export default function JournalWarehouseFilters({
  visible,
  onClose,
  dateFrom,
  dateTo,
  kind,
  kinds,
  onDateFrom,
  onDateTo,
  onKind,
  formatDate,
}: {
  visible: boolean;
  onClose: () => void;
  dateFrom: Date | null;
  dateTo: Date | null;
  kind: Kind | null;
  kinds: Array<{ key: Kind | null; label: string }>;
  onDateFrom: (value: Date | null) => void;
  onDateTo: (value: Date | null) => void;
  onKind: (value: Kind | null) => void;
  formatDate: (value: Date) => string;
}) {
  const p = useColors();
  const { fontScale } = useWindowDimensions();
  const [page, setPage] = useState<'overview' | 'period' | 'kind'>('overview');
  const [picker, setPicker] = useState<'from' | 'to' | null>(null);
  useEffect(() => {
    if (visible) {
      setPage('overview');
      setPicker(null);
    }
  }, [visible]);
  const close = () => {
    if (picker) setPicker(null);
    else if (page !== 'overview') setPage('overview');
    else onClose();
  };
  return (
    <JournalModal visible={visible} onRequestClose={close} onDismiss={onClose}>
      <JournalFilterHeader
        title={page === 'period' ? 'Период' : page === 'kind' ? 'Тип документа' : 'Фильтры документов'}
        closeLabel="Закрыть фильтры документов"
        detail={page !== 'overview'}
        onBack={() => setPage('overview')}
        onClose={onClose}
      />
      <KeyboardAwareScrollView style={s.scroll} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <JournalFilterPage page={page}>
          {page === 'overview' && (
            <>
              <JournalFilterGroup>
                <JournalFilterSummary
                  active={Boolean(dateFrom || dateTo)}
                  title="Период"
                  value={
                    dateFrom || dateTo
                      ? `${dateFrom ? formatDate(dateFrom) : 'Любая дата'} — ${dateTo ? formatDate(dateTo) : 'Любая дата'}`
                      : 'За всё время'
                  }
                  icon="calendar-outline"
                  onPress={() => setPage('period')}
                />
                <JournalFilterSummary
                  active={Boolean(kind)}
                  last
                  title="Тип документа"
                  value={kinds.find((item) => item.key === kind)?.label || 'Все'}
                  icon="document-text-outline"
                  onPress={() => setPage('kind')}
                />
              </JournalFilterGroup>
              <Text variant="footnote" color={p.text.secondary} style={s.hint}>
                Изменения применяются сразу.
              </Text>
            </>
          )}
          {page === 'period' && (
            <View style={s.dateFields}>
              {(['from', 'to'] as const).map((key, index) => {
                const date = key === 'from' ? dateFrom : dateTo;
                return (
                  <View style={[s.dateField, { backgroundColor: p.bg.card }]} key={key}>
                    <TouchableOpacity
                      style={[s.dateAction, s.flex]}
                      onPress={() => setPicker(key)}
                      accessibilityRole="button"
                      accessibilityLabel={`${index === 0 ? 'Документы с даты' : 'Документы по дату'}: ${date ? formatDate(date) : 'Любая дата'}`}
                    >
                      <Text variant="footnote" color={p.text.secondary}>
                        {index === 0 ? 'От' : 'До'}
                      </Text>
                      <Text color={p.text.primary}>{date ? formatDate(date) : 'Любая дата'}</Text>
                    </TouchableOpacity>
                    {date && (
                      <TouchableOpacity
                        style={s.clear}
                        onPress={() => (key === 'from' ? onDateFrom(null) : onDateTo(null))}
                        accessibilityRole="button"
                        accessibilityLabel={`Очистить дату документов ${key === 'from' ? 'от' : 'до'}`}
                      >
                        <Ionicons name="close-circle" size={22} color={p.text.secondary} />
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}
          {page === 'kind' &&
            kinds.map((item) => (
              <TouchableOpacity
                key={item.key || 'all'}
                style={[s.row, { borderBottomColor: p.border.subtle }]}
                accessibilityRole="radio"
                accessibilityLabel={item.label}
                accessibilityState={{ selected: kind === item.key }}
                onPress={() => {
                  onKind(item.key);
                  setPage('overview');
                }}
              >
                <Text color={p.text.primary} style={s.flex}>
                  {item.label}
                </Text>
                {kind === item.key && <Ionicons name="checkmark" size={22} color={p.accent.primaryText} />}
              </TouchableOpacity>
            ))}
        </JournalFilterPage>
      </KeyboardAwareScrollView>
      <View style={[s.footer, { borderTopColor: p.border.subtle }]}>
        <View
          style={[
            s.footerActions,
            fontScale > 1.3 && { flexDirection: 'column-reverse', alignItems: 'stretch', gap: 4 },
          ]}
        >
          {page === 'overview' && (
            <TouchableOpacity
              style={s.reset}
              accessibilityRole="button"
              onPress={() => {
                onKind(null);
                onDateFrom(null);
                onDateTo(null);
              }}
            >
              <Text color={p.accent.primaryText}>Сбросить</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[s.apply, { backgroundColor: p.bg.muted }]}
            accessibilityRole="button"
            onPress={() => (page === 'overview' ? onClose() : setPage('overview'))}
          >
            <Text variant="callout" color={p.accent.primaryText}>
              Готово
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      <DateTimePickerModal
        visible={visible && picker !== null}
        value={(picker === 'from' ? dateFrom : dateTo) || new Date()}
        mode="date"
        onCancel={() => setPicker(null)}
        onConfirm={(value) => {
          if (picker === 'from') onDateFrom(value);
          else onDateTo(value);
          setPicker(null);
        }}
      />
    </JournalModal>
  );
}
