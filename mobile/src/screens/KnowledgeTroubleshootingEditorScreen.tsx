/**
 * KnowledgeTroubleshootingEditorScreen — create / edit a troubleshooting entry
 * (manager only).
 *
 * Route params:
 *   • {}        — create new
 *   • { id }    — edit existing (prefills from getTroubleshooting)
 *
 * Fields: title, system, carMake, severity segment, symptom, cause, solution
 * (markdown), tags (comma / space separated). Delete available when editing.
 */
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { knowledgeApi } from '../api/services';
import { spacing, borderRadius, colors } from '../theme';
import { haptic } from '../platform/haptics';
import { severityStyle } from '../components/knowledge/severity';
import type { Troubleshooting, TroubleshootingSeverity } from '../../../shared/types';

type ParamList = { KnowledgeTroubleshootingEditor: { id?: string } };

const SEVERITIES: TroubleshootingSeverity[] = ['low', 'med', 'high'];

export default function KnowledgeTroubleshootingEditorScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ParamList, 'KnowledgeTroubleshootingEditor'>>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();

  const editId = route.params?.id;
  const isEdit = !!editId;

  const [title, setTitle] = React.useState('');
  const [system, setSystem] = React.useState('');
  const [carMake, setCarMake] = React.useState('');
  const [severity, setSeverity] = React.useState<TroubleshootingSeverity | null>(null);
  const [symptom, setSymptom] = React.useState('');
  const [cause, setCause] = React.useState('');
  const [solution, setSolution] = React.useState('');
  const [tagsText, setTagsText] = React.useState('');
  const [hydrated, setHydrated] = React.useState(false);

  const { data: existing, isLoading: loadingExisting } = useQuery<Troubleshooting>({
    queryKey: ['knowledge-troubleshooting-entry', editId],
    queryFn: async () => (await knowledgeApi.getTroubleshooting(editId as string)).data,
    enabled: isEdit,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (existing && !hydrated) {
      setTitle(existing.title);
      setSystem(existing.system ?? '');
      setCarMake(existing.carMake ?? '');
      setSeverity(existing.severity ?? null);
      setSymptom(existing.symptom ?? '');
      setCause(existing.cause ?? '');
      setSolution(existing.solution ?? '');
      setTagsText(existing.tags.join(', '));
      setHydrated(true);
    }
  }, [existing, hydrated]);

  const parseTags = (raw: string): string[] =>
    Array.from(
      new Set(
        raw
          .split(/[,\n]/)
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        system: system.trim() || null,
        carMake: carMake.trim() || null,
        severity,
        symptom: symptom.trim(),
        cause: cause.trim(),
        solution,
        tags: parseTags(tagsText),
      };
      if (isEdit) return (await knowledgeApi.updateTroubleshooting(editId as string, payload)).data;
      return (await knowledgeApi.createTroubleshooting(payload)).data;
    },
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['knowledge-troubleshooting'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['knowledge-troubleshooting-entry', editId] });
      navigation.goBack();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить. Попробуйте ещё раз.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => (await knowledgeApi.deleteTroubleshooting(editId as string)).data,
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['knowledge-troubleshooting'] });
      navigation.goBack();
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить запись.'),
  });

  const onSave = () => {
    if (!title.trim()) {
      Alert.alert('Заголовок обязателен', 'Введите краткое название неисправности.');
      return;
    }
    haptic('tap');
    saveMutation.mutate();
  };

  const confirmDelete = () => {
    Alert.alert('Удалить запись?', 'Действие необратимо.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);
  };

  const inputBg = palette.bg.card;
  const inputBorder = palette.border.subtle;

  if (isEdit && loadingExisting && !existing) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Редактирование" onBack={() => navigation.goBack()} />
        <LoadingSpinner />
      </View>
    );
  }

  const saveTrailing = (
    <Pressable
      onPress={onSave}
      disabled={saveMutation.isPending}
      hitSlop={10}
      style={[styles.saveBtn, { backgroundColor: palette.accent.primary, opacity: saveMutation.isPending ? 0.6 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel="Сохранить"
    >
      <Text variant="footnote" color={colors.white} style={{ fontWeight: '700' }}>
        {saveMutation.isPending ? '…' : 'Готово'}
      </Text>
    </Pressable>
  );

  const field = (
    label: string,
    value: string,
    onChange: (t: string) => void,
    opts?: { placeholder?: string; multiline?: boolean; minHeight?: number },
  ) => (
    <>
      <Text style={[iosSectionLabel, styles.label, { color: palette.text.secondary }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={opts?.placeholder}
        placeholderTextColor={palette.text.tertiary}
        multiline={opts?.multiline}
        textAlignVertical={opts?.multiline ? 'top' : 'center'}
        style={[
          styles.input,
          opts?.multiline ? { minHeight: opts.minHeight ?? 100, lineHeight: 22 } : null,
          { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary },
        ]}
      />
    </>
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={isEdit ? 'Редактирование' : 'Новая неисправность'}
        onBack={() => navigation.goBack()}
        trailing={saveTrailing}
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing[8] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {field('Заголовок', title, setTitle, { placeholder: 'Напр.: Стук в подвеске на кочках' })}

        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            {field('Система', system, setSystem, { placeholder: 'Двигатель' })}
          </View>
          <View style={{ flex: 1 }}>
            {field('Марка', carMake, setCarMake, { placeholder: 'Lada' })}
          </View>
        </View>

        {/* Severity segment */}
        <Text style={[iosSectionLabel, styles.label, { color: palette.text.secondary }]}>Серьёзность</Text>
        <View style={[styles.segment, { backgroundColor: palette.bg.muted }]}>
          {SEVERITIES.map((s) => {
            const active = severity === s;
            const sev = severityStyle(s);
            return (
              <Pressable
                key={s}
                onPress={() => {
                  haptic('select');
                  setSeverity(active ? null : s);
                }}
                style={[styles.segmentItem, active && { backgroundColor: palette.bg.card }]}
              >
                <Text variant="bodyEmph" style={{ color: active ? sev?.color ?? palette.text.primary : palette.text.secondary }}>
                  {sev?.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {field('Симптом', symptom, setSymptom, { placeholder: 'Что наблюдает клиент / мастер', multiline: true, minHeight: 80 })}
        {field('Причина', cause, setCause, { placeholder: 'Вероятная причина', multiline: true, minHeight: 80 })}
        {field('Решение (Markdown)', solution, setSolution, {
          placeholder: '1. Проверить…\n2. Заменить…',
          multiline: true,
          minHeight: 140,
        })}
        {field('Теги', tagsText, setTagsText, { placeholder: 'через запятую: стук, подвеска, стойки' })}

        {isEdit ? (
          <Pressable onPress={confirmDelete} style={[styles.deleteBtn, { borderColor: colors.red[200] }]}>
            <Ionicons name="trash-outline" size={18} color={colors.red[600]} />
            <Text variant="bodyEmph" style={{ color: colors.red[600] }}>
              Удалить запись
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  saveBtn: {
    height: 32,
    minWidth: 64,
    paddingHorizontal: spacing[3],
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { marginTop: spacing[4], marginBottom: spacing[2], marginLeft: spacing[1] },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: 15,
  },
  twoCol: { flexDirection: 'row', gap: spacing[3] },
  segment: { flexDirection: 'row', borderRadius: borderRadius.lg, padding: 3, gap: 3 },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[3.5],
    marginTop: spacing[6],
  },
});
