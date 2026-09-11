/**
 * UserPointsSheet — «НА КАКИХ ФИЛИАЛАХ МОЖЕТ РАБОТАТЬ СОТРУДНИК» (163).
 *
 * ТРЕБОВАНИЕ ВЛАДЕЛЬЦА ДОСЛОВНО: «чтобы в пользователях была настройка, на
 * каких филиалах они могут работать». Это ответ про ЧЕЛОВЕКА, поэтому живёт в
 * его карточке (список сотрудников и карточка сотрудника), а раздел «Филиалы»
 * показывает состав только для просмотра. Раньше было наоборот — назначали со
 * стороны филиала, и владелец, открывший карточку мастера, не видел ни его
 * доступов, ни способа их изменить.
 *
 * ЧТО ЭТО ЗНАЧИТ ДЛЯ ЧЕЛОВЕКА. Отмеченные филиалы — те, что он увидит в списке
 * при ВХОДЕ (филиал выбирается один раз, при входе, и живёт в сессии). Пустой
 * набор — НЕ «доступов нет», а «не ограничен»: доступны все живые филиалы.
 * Это конвенция внедрения (156) — тенант, который никого никуда не назначал,
 * продолжает работать без единой настройки. Подпись обязана говорить об этом
 * прямо, иначе владелец снимет все галочки, решив, что заблокировал человека,
 * и получит ровно обратное.
 *
 * ПОЧЕМУ СОХРАНЕНИЕ СПРАШИВАЕТ ПОДТВЕРЖДЕНИЕ. Снятие филиала НЕМЕДЛЕННО
 * обесточивает сессии сотрудника в нём: его следующий запрос получит 401
 * «Филиал больше не доступен — войдите заново». Мастер посреди смены увидит
 * экран входа. Это правильно (иначе он продолжал бы пробивать чеки там, откуда
 * его убрали), но владелец обязан знать об этом ДО нажатия, а не узнавать по
 * звонку мастера.
 *
 * ПРАВО — user_management, тот же ключ, что гейтит PUT /users/:id/points на
 * сервере. Вызывающие экраны сами решают, показывать ли вход; сюда без права
 * попасть нельзя, потому что запрос всё равно вернёт 403.
 */
import React from 'react';
import { Alert, Modal as RNModal, Pressable, ScrollView, StyleSheet, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { pointsApi } from '../../api/services';
import { POINTS_QUERY_KEY, pointKindLabel, usePointsQuery } from '../../hooks/usePoints';
import ModalBlurBackdrop from '../ModalBlurBackdrop';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { colors, spacing, borderRadius } from '../../theme';
import { apiErrorMessage } from '../../../../shared/utils/apiError';

export interface UserPointsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Кому настраиваем доступ. */
  userId: string;
  /** Имя — в заголовке: владелец должен видеть, чью карточку правит. */
  userName: string;
}

/** Ключ набора филиалов ОДНОГО сотрудника. Отдельный от ['points'] — разные данные. */
export const userPointsQueryKey = (userId: string) => ['user-points', userId] as const;

export function UserPointsSheet({ visible, onClose, userId, userName }: UserPointsSheetProps) {
  const palette = useColors();
  const queryClient = useQueryClient();

  // Живые филиалы тенанта — тот же ключ ['points'], что у индикатора и раздела:
  // лишней сети нет, слот почти всегда уже прогрет.
  const { data: pointsData, isLoading: pointsLoading } = usePointsQuery();
  const points = pointsData?.points ?? [];

  const { data: assigned, isError: assignedError } = useQuery({
    queryKey: userPointsQueryKey(userId),
    queryFn: async () => (await pointsApi.userPoints(userId)).data.pointIds,
    // Открыт диалог — есть запрос. Закрыт — не тратим сеть на каждую строку
    // списка сотрудников.
    enabled: visible,
    staleTime: 30_000,
  });

  const [selected, setSelected] = React.useState<string[]>([]);
  const [dirty, setDirty] = React.useState(false);

  // Пере-засеваем локальный выбор ответом сервера, пока владелец ничего не
  // трогал. Иначе фоновый refetch затирал бы уже проставленные галочки.
  React.useEffect(() => {
    if (!visible) {
      setDirty(false);
      return;
    }
    if (!dirty && assigned) setSelected(assigned);
  }, [visible, assigned, dirty]);

  const toggle = React.useCallback((pointId: string) => {
    haptic('select');
    setDirty(true);
    setSelected((prev) => (prev.includes(pointId) ? prev.filter((id) => id !== pointId) : [...prev, pointId]));
  }, []);

  const saveMutation = useMutation({
    mutationFn: async (pointIds: string[]) => (await pointsApi.setUserPoints(userId, pointIds)).data.pointIds,
    onSuccess: (applied) => {
      haptic('success');
      setDirty(false);
      // Сервер отбрасывает архивные филиалы — источник правды его ответ.
      queryClient.setQueryData(userPointsQueryKey(userId), applied);
      // memberIds в разделе «Филиалы» изменились этой же правкой.
      queryClient.invalidateQueries({ queryKey: POINTS_QUERY_KEY });
      onClose();
    },
    onError: (err) => {
      haptic('error');
      Alert.alert('Ошибка', apiErrorMessage(err) ?? 'Не удалось сохранить филиалы сотрудника');
    },
  });

  const handleSave = React.useCallback(() => {
    const unrestricted = selected.length === 0;
    // Кого выгоняем из смены прямо сейчас: филиалы, которые были и снялись.
    const removed = (assigned ?? []).filter((id) => !selected.includes(id));
    const removedNames = points
      .filter((p) => removed.includes(p.id))
      .map((p) => p.name)
      .join(', ');

    const consequence = unrestricted
      ? `${userName} сможет работать в любом филиале — ограничение снимается.`
      : removedNames
        ? `Доступ к «${removedNames}» будет снят. Если ${userName} сейчас работает там, приложение попросит его войти заново.`
        : `${userName} сможет входить только в отмеченные филиалы.`;

    haptic('warning');
    Alert.alert('Сохранить филиалы сотрудника?', consequence, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Сохранить', onPress: () => saveMutation.mutate(selected) },
    ]);
  }, [assigned, points, saveMutation, selected, userName]);

  /**
   * Готовы ли ПОКАЗЫВАТЬ галочки. Пока набор сотрудника не приехал, `selected`
   * пуст — а пустой набор в этой настройке означает «не ограничен». Отрисовать
   * его как факт значило бы показать владельцу неправду и дать нажать
   * «Сохранить», стерев реальные назначения. Поэтому до ответа — только
   * индикатор загрузки, и кнопка сохранения выключена.
   */
  const ready = !pointsLoading && assigned !== undefined;

  return (
    <RNModal visible={visible} animationType="fade" transparent onRequestClose={onClose} statusBarTranslucent>
      <ModalBlurBackdrop onPress={onClose} />
      <View style={styles.centerRoot} pointerEvents="box-none">
        <View style={[styles.card, { backgroundColor: palette.bg.elevated }]}>
          <View style={styles.header}>
            <View style={styles.headerSpacer} />
            <View style={styles.headerTitles}>
              <Text style={[styles.headerTitle, { color: palette.text.primary }]} numberOfLines={1}>
                Филиалы сотрудника
              </Text>
              <Text style={[styles.headerSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                {userName}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Закрыть"
              style={[styles.closeBtn, { backgroundColor: palette.bg.muted }]}
            >
              <Ionicons name="close" size={20} color={palette.text.secondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.intro, { color: palette.text.secondary }]}>
              Отметьте филиалы, в которые сотрудник сможет войти. Филиал выбирается при входе в приложение, а чтобы
              перейти в другой — нужно выйти и войти заново.
            </Text>

            {assignedError ? (
              <Text style={[styles.errorText, { color: colors.red[600] }]}>
                Не удалось загрузить филиалы сотрудника. Закройте окно и попробуйте ещё раз.
              </Text>
            ) : !ready ? (
              <ActivityIndicator color={palette.accent.primary} style={{ marginVertical: spacing[6] }} />
            ) : points.length === 0 ? (
              <Text style={[styles.intro, { color: palette.text.tertiary }]}>
                У автосервиса нет филиалов — настраивать нечего.
              </Text>
            ) : (
              points.map((point) => {
                const checked = selected.includes(point.id);
                return (
                  <Pressable
                    key={point.id}
                    onPress={() => toggle(point.id)}
                    style={styles.row}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    accessibilityLabel={`${point.name}, ${pointKindLabel(point).toLowerCase()}`}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={checked ? palette.accent.primary : palette.text.tertiary}
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.rowName, { color: palette.text.primary }]} numberOfLines={1}>
                        {point.name}
                      </Text>
                      <Text style={[styles.rowKind, { color: palette.text.tertiary }]} numberOfLines={1}>
                        {point.address ? `${pointKindLabel(point)} · ${point.address}` : pointKindLabel(point)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}

            {/* Пустой набор — самая опасная для понимания часть настройки:
                галочек нет, а доступ ЕСТЬ ко всему. Пишем это явно и там, где
                владелец увидит подпись ровно в момент, когда снял последнюю. */}
            {ready && points.length > 0 && (
              <View style={[styles.note, { backgroundColor: palette.bg.muted }]}>
                <Ionicons
                  name={selected.length === 0 ? 'information-circle' : 'information-circle-outline'}
                  size={16}
                  color={palette.text.tertiary}
                />
                <Text style={[styles.noteText, { color: palette.text.secondary }]}>
                  {selected.length === 0
                    ? 'Ни один филиал не отмечен — сотрудник не ограничен и может войти в любой филиал.'
                    : 'Сотрудник увидит при входе только отмеченные филиалы.'}
                </Text>
              </View>
            )}
          </ScrollView>

          <View style={[styles.actions, { borderTopColor: palette.border.subtle }]}>
            <Pressable
              onPress={onClose}
              style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
              accessibilityRole="button"
            >
              <Text style={[styles.cancelText, { color: palette.text.secondary }]}>Отмена</Text>
            </Pressable>
            <Pressable
              onPress={handleSave}
              disabled={saveMutation.isPending || !ready || points.length === 0}
              style={[
                styles.saveBtn,
                {
                  backgroundColor: palette.accent.primary,
                  opacity: saveMutation.isPending || !ready || points.length === 0 ? 0.5 : 1,
                },
              ]}
              accessibilityRole="button"
            >
              {saveMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.saveText}>Сохранить</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  centerRoot: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[4] },
  card: {
    width: '88%',
    maxWidth: 460,
    maxHeight: 560,
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingTop: spacing[3.5],
    paddingBottom: spacing[2],
  },
  headerSpacer: { width: 32, height: 32 },
  headerTitles: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', letterSpacing: -0.2 },
  headerSub: { fontSize: 12, marginTop: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 0 },
  bodyContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[1],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  intro: { fontSize: 13, lineHeight: 18 },
  errorText: { fontSize: 13, lineHeight: 18, paddingVertical: spacing[4] },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], paddingVertical: spacing[2.5], minHeight: 44 },
  rowName: { fontSize: 15, fontWeight: '600' },
  rowKind: { fontSize: 12, marginTop: 1 },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    marginTop: spacing[1],
  },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17 },
  actions: {
    flexDirection: 'row',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    minHeight: 44,
  },
  cancelText: { fontSize: 15, fontWeight: '600' },
  saveBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    borderRadius: borderRadius['2xl'],
    minHeight: 44,
  },
  saveText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});

export default UserPointsSheet;
