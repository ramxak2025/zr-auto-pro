import React from 'react';
import { Alert, AppState, Platform, TextInput, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { randomUUID } from 'expo-crypto';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from '@react-navigation/native';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import { usePlatformSession } from './usePlatformData';
import { assertPlatformSession } from './platformSession';
import { AdminAction, AdminGroup, AdminHeading, AdminRow, AdminState, adminUIStyles } from './AdminUI';
import { formatDateTime } from './adminShared';
import { prepareNoteRequest, type NoteRequest } from './noteRequest';
const PAGE_SIZE = 20;
export default function TenantNotes({ tenantId }: { tenantId: string }) {
  const { session } = usePlatformSession();
  return <TenantNotesContent key={`${tenantId}:${session.data.generation}:${session.authEpoch}`} tenantId={tenantId} />;
}
function TenantNotesContent({ tenantId }: { tenantId: string }) {
  const { session, allowed } = usePlatformSession(),
    p = useColors(),
    client = useQueryClient();
  const [text, setText] = React.useState(''),
    [saving, setSaving] = React.useState(false);
  const request = React.useRef<NoteRequest | null>(null);
  const [date, setDate] = React.useState<Date | null>(null),
    [picker, setPicker] = React.useState<'date' | 'time' | null>(null);
  const [editingFollowUp, setEditingFollowUp] = React.useState(false);
  const query = useInfiniteQuery({
    queryKey: ['manager', 'tenant-notes', tenantId, session.data.key, session.data.generation],
    enabled: allowed && !!tenantId,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      assertPlatformSession(session, allowed);
      const r = await session.manager.notes(tenantId, { limit: PAGE_SIZE, offset: pageParam });
      assertPlatformSession(session, allowed);
      return r.data;
    },
    getNextPageParam: (last, pages) => {
      const count = pages.reduce((sum, page) => sum + page.items.length, 0);
      return last.items.length > 0 && count < last.total ? count : undefined;
    },
  });
  const refresh = React.useCallback(() => {
    if (allowed && session.isCurrent()) void query.refetch();
  }, [allowed, session, query.refetch]);
  useFocusEffect(
    React.useCallback(() => {
      refresh();
    }, [refresh]),
  );
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  const add = async () => {
    if (!allowed || saving) return;
    let payload: NoteRequest;
    try {
      payload = prepareNoteRequest(text, request.current, randomUUID);
    } catch {
      Alert.alert('Проверьте заметку', 'Введите от 1 до 4000 символов.');
      return;
    }
    request.current = payload;
    setSaving(true);
    try {
      assertPlatformSession(session, allowed);
      await session.manager.addNote(tenantId, payload);
      assertPlatformSession(session, allowed);
      setText('');
      request.current = null;
      await query.refetch();
    } catch {
      if (session.isCurrent())
        Alert.alert('Не удалось подтвердить сохранение', 'Повторите отправку. Повтор не создаст вторую заметку.');
    } finally {
      if (session.isCurrent()) setSaving(false);
    }
  };
  const followUp = query.data?.pages[0]?.nextContactAt;
  const saveFollowUp = async (next: string | null) => {
    if (!allowed || saving) return;
    setSaving(true);
    try {
      assertPlatformSession(session, allowed);
      await session.manager.setFollowUp(tenantId, { nextContactAt: next });
      assertPlatformSession(session, allowed);
      setEditingFollowUp(false);
      setPicker(null);
      await Promise.all([query.refetch(), client.invalidateQueries({ queryKey: ['manager', 'reminders'] })]);
    } catch {
      if (session.isCurrent()) Alert.alert('Не удалось сохранить контакт', 'Проверьте соединение и повторите.');
    } finally {
      if (session.isCurrent()) setSaving(false);
    }
  };
  if (!allowed) return null;
  const denied = [403, 404].includes((query.error as { response?: { status?: number } } | null)?.response?.status ?? 0);
  if (denied) return <AdminState empty="Заметки недоступны для этой учётной записи." />;
  return (
    <View style={{ gap: 12 }}>
      <AdminHeading>Сопровождение клиента</AdminHeading>
      <Text variant="footnote" color={p.text.secondary}>
        Внутренние заметки платформы. Клиент их не видит. Автор и время сохраняются; текст нельзя изменить.
      </Text>
      <AdminState loading={query.isPending} error={query.isError} onRetry={refresh} />
      {query.data ? (
        <>
          <AdminGroup>
            <AdminRow
              label="Следующий контакт"
              detail={followUp ? formatDateTime(followUp) : 'Не запланирован'}
              icon="phone"
              onPress={() => {
                setDate(followUp ? new Date(followUp) : new Date(Date.now() + 86400000));
                setEditingFollowUp(true);
              }}
            />
            {editingFollowUp && date ? (
              <View style={{ gap: 8, paddingVertical: 12 }}>
                {Platform.OS === 'ios' ? (
                  <DateTimePicker
                    value={date}
                    mode="datetime"
                    display="compact"
                    locale="ru-RU"
                    onChange={(_, selected) => {
                      if (selected) setDate(selected);
                    }}
                    themeVariant={p.mode}
                  />
                ) : (
                  <>
                    <AdminAction
                      label={`Дата и время · ${formatDateTime(date.toISOString())}`}
                      onPress={() => setPicker('date')}
                    />
                    {picker ? (
                      <DateTimePicker
                        value={date}
                        mode={picker}
                        onChange={(event, selected) => {
                          if (event.type !== 'set' || !selected) {
                            setPicker(null);
                            return;
                          }
                          setDate(selected);
                          setPicker(picker === 'date' ? 'time' : null);
                        }}
                      />
                    ) : null}
                  </>
                )}
                <AdminAction
                  label="Запланировать контакт"
                  disabled={saving}
                  onPress={() => void saveFollowUp(date.toISOString())}
                />
                {followUp ? (
                  <AdminAction
                    label="Убрать запланированный контакт"
                    disabled={saving}
                    onPress={() => void saveFollowUp(null)}
                  />
                ) : null}
                <AdminAction
                  label="Отмена"
                  disabled={saving}
                  onPress={() => {
                    setEditingFollowUp(false);
                    setPicker(null);
                  }}
                />
              </View>
            ) : null}
          </AdminGroup>
          <AdminGroup>
            {query.data.pages
              .flatMap((page) => page.items)
              .filter((item, index, items) => items.findIndex((other) => other.id === item.id) === index)
              .map((note) => (
                <View key={note.id} style={{ paddingVertical: 12, gap: 6 }}>
                  <Text selectable color={p.text.primary}>
                    {note.text}
                  </Text>
                  <Text variant="footnote" color={p.text.secondary}>
                    {note.authorName || 'Сотрудник платформы'} · {formatDateTime(note.createdAt)}
                  </Text>
                </View>
              ))}
            {query.data.pages[0].total === 0 ? (
              <AdminState empty="Зафиксируйте договорённости и итоги разговора с клиентом." />
            ) : null}
            {query.hasNextPage ? (
              <AdminAction
                label={query.isFetchingNextPage ? 'Загружаем…' : 'Ранние заметки'}
                disabled={query.isFetchingNextPage}
                onPress={() => void query.fetchNextPage()}
              />
            ) : null}
          </AdminGroup>
        </>
      ) : null}
      <TextInput
        accessibilityLabel="Внутренняя заметка"
        multiline
        value={text}
        editable={!saving}
        maxLength={4000}
        onChangeText={setText}
        placeholder="Добавить внутреннюю заметку"
        placeholderTextColor={p.text.secondary}
        style={[
          adminUIStyles.input,
          { minHeight: 100, textAlignVertical: 'top', color: p.text.primary, backgroundColor: p.bg.card },
        ]}
      />
      <AdminAction
        label={saving ? 'Сохраняем…' : 'Добавить заметку'}
        disabled={saving || !text.trim()}
        onPress={() => void add()}
      />
    </View>
  );
}
