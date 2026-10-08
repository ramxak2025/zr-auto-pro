import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  useAttendanceNfcSession,
  NFC_STATUS_QUERY_KEY,
  nfcStatusQueryKey,
  nfcTagsQueryKey,
} from '../hooks/useAttendanceNfcSession';
import { useColors } from '../contexts/ThemeContext';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import IosScreenHeader from '../components/IosScreenHeader';
import { parseAttendanceNfcUri } from '../../../shared/utils/attendanceNfcUri';
import type { AttendanceNfcTag, CreatedAttendanceNfcTag } from '../../../shared/types';
import {
  checkAttendanceNfcHardware,
  writeAttendanceNfcUriAndReadBack,
  cancelAttendanceNfcOperation,
  createAttendanceNfcOperation,
} from '../utils/attendanceNfcDevice';
import { createNfcOperationLeaseController } from '../utils/nfcOperationLease';
import { runNfcCreateTagOperation } from '../utils/nfcCreateTagOperation';

export default function NfcTagsScreen() {
  const palette = useColors();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { api, session, token } = useAttendanceNfcSession();
  const [name, setName] = useState('');
  const [renameValues, setRenameValues] = useState<Record<string, string>>({});
  const [pendingTag, setPendingTag] = useState<CreatedAttendanceNfcTag | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = React.useRef(false);
  const [createFailed, setCreateFailed] = useState(false);
  const [hardware, setHardware] = useState<'loading' | 'ready' | 'disabled' | 'unsupported'>('loading');
  const focusedRef = React.useRef(false);
  const focusGenerationRef = React.useRef(0);
  const createGenerationRef = React.useRef(0);
  const operationController = React.useRef(createNfcOperationLeaseController()).current;
  const nativeOperationRef = React.useRef<ReturnType<typeof createAttendanceNfcOperation> | null>(null);
  const statusQuery = useQuery({
    queryKey: nfcStatusQueryKey(session),
    queryFn: async () => {
      const response = await api!.nfcStatus();
      if (!session?.isCurrent()) throw new Error('Сессия изменилась');
      return response.data;
    },
    enabled: !!api && !!session,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const tagsQuery = useQuery({
    queryKey: nfcTagsQueryKey(session),
    queryFn: async () => {
      const response = await api!.nfcTags();
      if (!session?.isCurrent()) throw new Error('Сессия изменилась');
      return response.data;
    },
    enabled: !!api && !!session && statusQuery.data?.canManageTags === true,
  });
  const sessionIdentity = session
    ? `${session.owner.tenantId}:${session.owner.userId}:${session.owner.pointId ?? ''}:${token ?? ''}`
    : '';

  useFocusEffect(
    useCallback(() => {
      let active = true;
      focusedRef.current = true;
      focusGenerationRef.current += 1;
      setHardware('loading');
      void checkAttendanceNfcHardware()
        .then((state) => {
          if (active) setHardware(state);
        })
        .catch(() => {
          if (active) setHardware('unsupported');
        });
      return () => {
        active = false;
        focusedRef.current = false;
        focusGenerationRef.current += 1;
        createGenerationRef.current += 1;
        operationController.invalidate();
        const operation = nativeOperationRef.current;
        nativeOperationRef.current = null;
        if (operation) void cancelAttendanceNfcOperation(operation);
        setPendingTag(null);
        creatingRef.current = false;
        setCreating(false);
        setBusyId(null);
      };
    }, [sessionIdentity]),
  );

  useEffect(() => {
    setPendingTag(null);
    setBusyId(null);
  }, [sessionIdentity]);

  const createTag = async () => {
    if (!api || !session?.isCurrent() || !focusedRef.current || creatingRef.current || !name.trim()) return;
    const ownedSession = session;
    const ownedApi = api;
    const focusGeneration = focusGenerationRef.current;
    const createGeneration = ++createGenerationRef.current;
    const isCurrent = () =>
      focusedRef.current &&
      focusGenerationRef.current === focusGeneration &&
      createGenerationRef.current === createGeneration &&
      ownedSession.isCurrent();
    creatingRef.current = true;
    setCreating(true);
    setCreateFailed(false);
    await runNfcCreateTagOperation({
      request: async () => (await ownedApi.createNfcTag({ name: name.trim() })).data,
      isCurrent,
      onSuccess: (created) => {
        setName('');
        setPendingTag(created);
        const { token: _token, ndefUri: _ndefUri, ...metadata } = created;
        queryClient.setQueryData<AttendanceNfcTag[]>(nfcTagsQueryKey(ownedSession), (current) =>
          current ? [metadata, ...current] : [metadata],
        );
      },
      onError: () => setCreateFailed(true),
      onFinally: () => {
        creatingRef.current = false;
        setCreating(false);
      },
    });
  };

  const renameMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      if (!api || !session?.isCurrent()) throw new Error('Нет активной сессии');
      const lease = session.lease;
      return { tag: (await api.renameNfcTag(id, value.trim())).data, lease };
    },
    onSuccess: ({ tag: updated, lease }) => {
      if (!session?.isCurrent() || session.lease !== lease) return;
      queryClient.setQueryData<AttendanceNfcTag[]>(nfcTagsQueryKey(session), (current) =>
        current?.map((tag) => (tag.id === updated.id ? updated : tag)),
      );
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!api || !session?.isCurrent()) throw new Error('Нет активной сессии');
      const lease = session.lease;
      return { tag: (await api.revokeNfcTag(id)).data, lease };
    },
    onSuccess: ({ tag: updated, lease }) => {
      if (!session?.isCurrent() || session.lease !== lease) return;
      queryClient.setQueryData<AttendanceNfcTag[]>(nfcTagsQueryKey(session), (current) =>
        current?.map((tag) => (tag.id === updated.id ? updated : tag)),
      );
      queryClient.invalidateQueries({ queryKey: NFC_STATUS_QUERY_KEY });
      if (pendingTag?.id === updated.id) setPendingTag(null);
    },
  });

  const writeAndActivate = async () => {
    if (!pendingTag || busyId || !session) return;
    const tag = pendingTag;
    const ownedSession = session;
    const operationLease = operationController.begin(() => focusedRef.current && ownedSession.isCurrent());
    const isCurrent = operationLease.isCurrent;
    const nativeOperation = createAttendanceNfcOperation(isCurrent);
    nativeOperationRef.current = nativeOperation;
    setBusyId(tag.id);
    try {
      const state = await checkAttendanceNfcHardware(nativeOperation);
      if (!isCurrent()) return;
      setHardware(state);
      if (state !== 'ready') return;
      const expected = parseAttendanceNfcUri(tag.ndefUri);
      if (!expected || expected.token !== tag.token)
        throw new Error('Сервер вернул некорректную ссылку метки. Отзовите её и создайте новую.');
      const readBackUri = await writeAttendanceNfcUriAndReadBack(nativeOperation, tag.ndefUri);
      if (!isCurrent()) return;
      const readBack = parseAttendanceNfcUri(readBackUri);
      if (!readBack || readBack.token !== tag.token)
        throw new Error('Проверка не совпала. Метка осталась неактивной; попробуйте записать её ещё раз.');
      if (!api || !isCurrent()) throw new Error('Сессия изменилась. Активируйте метку заново.');
      const activated = (await api.activateNfcTag(tag.id, readBack.token)).data;
      if (!isCurrent()) return;
      queryClient.setQueryData<AttendanceNfcTag[]>(nfcTagsQueryKey(ownedSession), (current) =>
        current?.map((item) => (item.id === activated.id ? activated : item)),
      );
      queryClient.invalidateQueries({ queryKey: NFC_STATUS_QUERY_KEY });
      setPendingTag(null);
      Alert.alert(
        'Метка активирована',
        'Autexa прочитала записанную ссылку и подтвердила метку. Статические NFC-метки можно копировать — выдавайте доступ только доверенным сотрудникам.',
      );
    } catch (error) {
      if (!isCurrent()) return;
      const message = error instanceof Error ? error.message : 'Не удалось записать NFC-метку.';
      Alert.alert('Метка не активирована', message);
    } finally {
      if (nativeOperationRef.current === nativeOperation) nativeOperationRef.current = null;
      if (isCurrent()) setBusyId(null);
    }
  };

  const statusText = useMemo(
    () =>
      hardware === 'loading'
        ? 'Проверяем NFC…'
        : hardware === 'unsupported'
          ? 'Это устройство не поддерживает NFC.'
          : hardware === 'disabled'
            ? 'Включите NFC в настройках устройства.'
            : '',
    [hardware],
  );
  const tagStatus = (tag: AttendanceNfcTag) =>
    tag.status === 'active' ? 'Активна' : tag.status === 'pending' ? 'Ожидает записи' : 'Отозвана';

  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="NFC-метки" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!statusQuery.data?.canManageTags && !statusQuery.isLoading && (
          <Text style={[styles.body, { color: palette.text.secondary }]}>
            Управлять метками может владелец автосервиса.
          </Text>
        )}
        {statusQuery.isLoading || tagsQuery.isLoading ? <ActivityIndicator color={colors.primary[600]} /> : null}
        {(statusQuery.isError || tagsQuery.isError) && (
          <Retry
            onPress={() => {
              void statusQuery.refetch();
              void tagsQuery.refetch();
            }}
          />
        )}
        {statusQuery.data?.canManageTags && (
          <>
            <View style={[styles.panel, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              <Text style={[styles.heading, { color: palette.text.primary }]}>Новая метка</Text>
              <Text style={[styles.body, { color: palette.text.secondary }]}>
                Создайте метку, запишите ссылку, затем приложите её ещё раз для проверки. Пока проверка не пройдена,
                метка не работает.
              </Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Например, Вход в мастерскую"
                placeholderTextColor={palette.text.tertiary}
                style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                maxLength={80}
              />
              <PrimaryButton
                label={creating ? 'Создаём…' : 'Создать метку'}
                disabled={creating || !name.trim()}
                onPress={() => void createTag()}
              />
              {createFailed && (
                <Text style={styles.error}>Не удалось создать метку. Проверьте соединение и повторите.</Text>
              )}
              {pendingTag && (
                <View style={[styles.pending, { backgroundColor: palette.bg.canvas }]}>
                  <Text style={[styles.heading, { color: palette.text.primary }]}>Запишите «{pendingTag.name}»</Text>
                  <Text style={[styles.body, { color: palette.text.secondary }]}>
                    {statusText ||
                      'Поднесите пустую NFC-метку к устройству. После записи приложение попросит приложить её ещё раз.'}
                  </Text>
                  <PrimaryButton
                    label={busyId ? 'Записываем и проверяем…' : 'Записать и проверить'}
                    disabled={
                      busyId !== null || hardware === 'loading' || hardware === 'unsupported' || hardware === 'disabled'
                    }
                    onPress={() => void writeAndActivate()}
                  />
                  <Text style={[styles.caption, { color: palette.text.tertiary }]}>
                    Если закрыть этот экран, секретная ссылка будет потеряна. Отзовите эту ожидающую метку и создайте
                    новую.
                  </Text>
                </View>
              )}
            </View>
            <Text style={[styles.heading, { color: palette.text.primary }]}>Список меток</Text>
            {(tagsQuery.data ?? []).map((tag) => (
              <View
                key={tag.id}
                style={[styles.panel, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <Text
                  style={[
                    styles.status,
                    { color: tag.status === 'active' ? colors.primary[700] : palette.text.secondary },
                  ]}
                >
                  {tagStatus(tag)}
                </Text>
                <TextInput
                  value={renameValues[tag.id] ?? tag.name}
                  onChangeText={(value) => setRenameValues((current) => ({ ...current, [tag.id]: value }))}
                  style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                  maxLength={80}
                />
                <View style={styles.row}>
                  <SecondaryButton
                    label="Сохранить имя"
                    disabled={
                      renameMutation.isPending ||
                      !(renameValues[tag.id] ?? tag.name).trim() ||
                      (renameValues[tag.id] ?? tag.name).trim() === tag.name
                    }
                    onPress={() => renameMutation.mutate({ id: tag.id, value: renameValues[tag.id] ?? tag.name })}
                  />
                  {tag.status !== 'revoked' && (
                    <SecondaryButton
                      label="Отозвать"
                      disabled={revokeMutation.isPending}
                      onPress={() =>
                        Alert.alert('Отозвать метку?', 'Она больше не будет отмечать присутствие.', [
                          { text: 'Отмена', style: 'cancel' },
                          { text: 'Отозвать', style: 'destructive', onPress: () => revokeMutation.mutate(tag.id) },
                        ])
                      }
                    />
                  )}
                </View>
              </View>
            ))}
            {tagsQuery.data?.length === 0 && (
              <Text style={[styles.body, { color: palette.text.secondary }]}>Метки ещё не созданы.</Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Retry({ onPress }: { onPress: () => void }) {
  return <SecondaryButton label="Повторить загрузку" onPress={onPress} />;
}
function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.primary, disabled && styles.disabled]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </TouchableOpacity>
  );
}
function SecondaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.secondary, disabled && styles.disabled]}
    >
      <Text style={styles.secondaryText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[10] },
  panel: { borderWidth: 1, borderRadius: borderRadius.lg, padding: spacing[4], gap: spacing[3] },
  heading: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  body: { fontSize: fontSize.sm, lineHeight: 21 },
  caption: { fontSize: fontSize.xs, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: fontSize.base,
  },
  primary: {
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  secondary: {
    borderWidth: 1,
    borderColor: colors.primary[500],
    borderRadius: borderRadius.md,
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    alignItems: 'center',
  },
  secondaryText: { color: colors.primary[700], fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  status: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  pending: { padding: spacing[3], borderRadius: borderRadius.md, gap: spacing[2] },
  error: { color: colors.red[600], fontSize: fontSize.sm },
});
