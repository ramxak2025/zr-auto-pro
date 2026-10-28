import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
import { type AttendanceNfcTag, type CreatedAttendanceNfcTag } from '../../../shared/types';
import {
  AttendanceNfcDeviceError,
  checkAttendanceNfcHardware,
  writeAttendanceNfcUriAndReadBack,
  cancelAttendanceNfcOperation,
  createAttendanceNfcOperation,
  readAttendanceNfcUri,
  describeAttendanceNfcDeviceError,
  type NfcTagReplacement,
  type NfcWritePhase,
} from '../utils/attendanceNfcDevice';
import { createNfcOperationLeaseController } from '../utils/nfcOperationLease';
import { runNfcCreateTagOperation } from '../utils/nfcCreateTagOperation';
import { runNfcTagActivation } from '../utils/nfcTagActivation';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { extractApiErrorMessage } from '../utils/apiError';

import { useScreenSectionScroll } from '../components/ScreenSectionHeader';
import { ScreenSectionScrollView } from '../components/ScreenSectionScrollable';

type EnrollmentPhase = 'ready' | NfcWritePhase | 'activating' | 'success' | 'error';
const phaseLabels: Record<EnrollmentPhase, string> = {
  ready: 'Готова к записи',
  connecting: 'Ожидаем метку',
  checking: 'Проверяем метку',
  writing: 'Записываем ссылку',
  verifying: 'Проверяем запись',
  activating: 'Активируем в Autexa',
  success: 'Метка активирована',
  error: 'Нужна повторная проверка',
};

export default function NfcTagsScreen() {
  const section = useScreenSectionScroll({ composition: 'navigation' });
  const palette = useColors();
  const navigation = useNavigation();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { api, session, token } = useAttendanceNfcSession();
  const [name, setName] = useState('');
  const [renameValues, setRenameValues] = useState<Record<string, string>>({});
  const [pendingTag, setPendingTag] = useState<CreatedAttendanceNfcTag | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = React.useRef(false);
  const [recoveryTag, setRecoveryTag] = useState<AttendanceNfcTag | null>(null);
  const [phase, setPhase] = useState<EnrollmentPhase>('ready');
  const [notice, setNotice] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<NfcTagReplacement | null>(null);
  const [activatedName, setActivatedName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
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
        setRecoveryTag(null);
        setReplacement(null);
        setNotice(null);
        setPhase('ready');
        busyRef.current = false;
        creatingRef.current = false;
        setCreating(false);
        setBusyId(null);
      };
    }, [sessionIdentity]),
  );

  useEffect(() => {
    setPendingTag(null);
    setRecoveryTag(null);
    setReplacement(null);
    setNotice(null);
    setPhase('ready');
    setBusyId(null);
  }, [sessionIdentity]);

  const createTag = async () => {
    if (
      !api ||
      !session?.isCurrent() ||
      !focusedRef.current ||
      creatingRef.current ||
      pendingTag ||
      recoveryTag ||
      !name.trim()
    )
      return;
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
        setPhase('ready');
        setNotice(null);
        setReplacement(null);
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
      if (recoveryTag?.id === updated.id) setRecoveryTag(null);
      setReplacement(null);
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!api || !session?.isCurrent()) throw new Error('Нет активной сессии');
      const lease = session.lease;
      return { tag: (await api.archiveNfcTag(id)).data, lease };
    },
    onSuccess: ({ tag: archived, lease }) => {
      if (!session?.isCurrent() || session.lease !== lease) return;
      queryClient.setQueryData<AttendanceNfcTag[]>(nfcTagsQueryKey(session), (current) =>
        current?.filter((tag) => tag.id !== archived.id),
      );
    },
  });

  const enrollmentTag = pendingTag ?? recoveryTag;
  const writeAndActivate = async (confirmedReplacement?: NfcTagReplacement) => {
    if (!enrollmentTag || busyRef.current || !session || !api || !focusedRef.current) return;
    const tag = enrollmentTag;
    const ownedSession = session;
    const ownedApi = api;
    const operationLease = operationController.begin(() => focusedRef.current && ownedSession.isCurrent());
    const isCurrent = operationLease.isCurrent;
    const nativeOperation = createAttendanceNfcOperation(isCurrent);
    nativeOperationRef.current = nativeOperation;
    busyRef.current = true;
    setBusyId(tag.id);
    setPhase('connecting');
    setNotice(null);
    setReplacement(null);
    try {
      if (pendingTag) {
        const expected = parseAttendanceNfcUri(pendingTag.ndefUri);
        if (!expected || expected.token !== pendingTag.token)
          throw new Error('Не удалось подготовить ссылку. Отзовите эту метку и создайте новую.');
      }
      const activated = await runNfcTagActivation({
        tagId: tag.id,
        expectedToken: pendingTag?.token,
        isCurrent,
        read: () =>
          pendingTag
            ? writeAttendanceNfcUriAndReadBack(nativeOperation, pendingTag.ndefUri, {
                replacement: confirmedReplacement,
                onPhase: (value) => {
                  if (isCurrent()) setPhase(value);
                },
              })
            : readAttendanceNfcUri(nativeOperation, 'Приложите метку, запись которой была прервана'),
        activate: async (id, readToken) => (await ownedApi.activateNfcTag(id, readToken)).data,
        onActivating: () => setPhase('activating'),
      });
      if (!activated || !isCurrent()) return;
      queryClient.setQueryData<AttendanceNfcTag[]>(nfcTagsQueryKey(ownedSession), (current) =>
        current?.map((item) => (item.id === activated.id ? activated : item)),
      );
      queryClient.invalidateQueries({ queryKey: NFC_STATUS_QUERY_KEY });
      setPendingTag(null);
      setRecoveryTag(null);
      setActivatedName(activated.name);
      setPhase('success');
    } catch (error) {
      if (!isCurrent()) return;
      setPhase('error');
      setReplacement(error instanceof AttendanceNfcDeviceError ? (error.replacement ?? null) : null);
      setNotice(
        error instanceof AttendanceNfcDeviceError
          ? describeAttendanceNfcDeviceError(error)
          : extractApiErrorMessage(error, 'Не удалось подтвердить активацию. Проверьте интернет и повторите.'),
      );
    } finally {
      if (nativeOperationRef.current === nativeOperation) nativeOperationRef.current = null;
      if (isCurrent()) {
        busyRef.current = false;
        setBusyId(null);
      }
    }
  };

  const cancelScan = () => {
    operationController.invalidate();
    const operation = nativeOperationRef.current;
    nativeOperationRef.current = null;
    if (operation) void cancelAttendanceNfcOperation(operation);
    busyRef.current = false;
    setBusyId(null);
    setPhase('ready');
    setReplacement(null);
    setNotice('Проверка остановлена. Приложите ту же метку, чтобы продолжить и проверить её состояние.');
  };

  const closeEnrollment = () => {
    cancelScan();
    setPendingTag(null);
    setRecoveryTag(null);
    setNotice(null);
  };

  const confirmReplacement = () => {
    if (!replacement || !session || !enrollmentTag || busyRef.current) return;
    const consent = replacement;
    const owner = session;
    const focusGeneration = focusGenerationRef.current;
    const operationGeneration = operationController.begin(() => focusedRef.current && owner.isCurrent());
    Alert.alert(
      'Заменить данные на метке?',
      'Прежние данные будут удалены. После подтверждения приложите ту же метку: Autexa проверит её перед записью.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Заменить данные',
          style: 'destructive',
          onPress: () => {
            if (operationGeneration.isCurrent() && focusGenerationRef.current === focusGeneration)
              void writeAndActivate(consent);
          },
        },
      ],
    );
  };

  const hardwareText =
    hardware === 'loading'
      ? 'Проверяем NFC…'
      : hardware === 'unsupported'
        ? 'Это устройство не поддерживает NFC.'
        : hardware === 'disabled'
          ? 'Включите NFC в настройках телефона.'
          : '';
  const tagStatus = (tag: AttendanceNfcTag) =>
    tag.status === 'active' ? 'Активна' : tag.status === 'pending' ? 'Ожидает записи' : 'Отозвана';

  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader scroll={section} title="NFC-метки" onBack={() => navigation.goBack()} />
      <ScreenSectionScrollView
        onScroll={section.onScroll}
        contentInsetAdjustmentBehavior="never"
        scrollEventThrottle={16}
        contentContainerStyle={[
          [styles.content, { paddingBottom: tabBarHeight + spacing[6] }],
          { paddingTop: section.contentTop + spacing[4] },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {!statusQuery.data?.canManageTags && !statusQuery.isLoading && !statusQuery.isError && (
          <Text style={[styles.body, { color: palette.text.secondary }]}>
            Управлять метками может владелец автосервиса.
          </Text>
        )}
        {statusQuery.isLoading || tagsQuery.isLoading ? <ActivityIndicator color={palette.accent.primary} /> : null}
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
              {phase === 'success' ? (
                <>
                  <Text accessibilityRole="header" style={[styles.heading, { color: palette.text.primary }]}>
                    Метка активирована
                  </Text>
                  <Text accessibilityLiveRegion="polite" style={[styles.body, { color: palette.text.secondary }]}>
                    «{activatedName}» записана, проверена и подтверждена Autexa. Теперь ей можно отмечать рабочую смену.
                  </Text>
                  <PrimaryButton label="Добавить ещё метку" onPress={() => setPhase('ready')} />
                </>
              ) : enrollmentTag ? (
                <>
                  <Text accessibilityRole="header" style={[styles.heading, { color: palette.text.primary }]}>
                    {enrollmentTag.name}
                  </Text>
                  <Text style={[styles.body, { color: palette.text.secondary }]}>
                    {pendingTag
                      ? 'Запишем ссылку, проверим её и активируем метку.'
                      : 'Приложите метку, которую уже начали записывать. Autexa проверит её и завершит активацию.'}
                  </Text>
                  <View style={styles.progress} accessibilityLiveRegion="polite">
                    {busyId ? <ActivityIndicator color={palette.accent.primary} /> : null}
                    <Text style={[styles.progressText, { color: palette.text.primary }]}>
                      {phase === 'ready' ? (pendingTag ? 'Готова к записи' : 'Готова к проверке') : phaseLabels[phase]}
                    </Text>
                  </View>
                  <Text style={[styles.caption, { color: palette.text.secondary }]}>
                    {busyId
                      ? phase === 'activating'
                        ? 'Метка прочитана. Ждём подтверждения сервера.'
                        : 'Удерживайте метку рядом с телефоном до окончания проверки.'
                      : hardwareText ||
                        'Системная галочка подтверждает чтение телефоном. Дождитесь активации в Autexa.'}
                  </Text>
                  {notice && (
                    <Text
                      accessibilityLiveRegion="polite"
                      style={[styles.body, { color: phase === 'error' ? colors.red[600] : palette.text.secondary }]}
                    >
                      {notice}
                    </Text>
                  )}
                  {replacement ? (
                    <>
                      <PrimaryButton label="Заменить данные" onPress={confirmReplacement} />
                      <SecondaryButton
                        label="Использовать другую метку"
                        onPress={() => {
                          setReplacement(null);
                          setNotice(null);
                          setPhase('ready');
                        }}
                      />
                    </>
                  ) : (
                    <PrimaryButton
                      label={
                        busyId
                          ? phaseLabels[phase]
                          : hardware === 'disabled'
                            ? 'Проверить NFC и продолжить'
                            : phase === 'error'
                              ? 'Повторить проверку'
                              : pendingTag
                                ? 'Записать метку'
                                : 'Проверить и активировать'
                      }
                      disabled={!!busyId || hardware === 'loading' || hardware === 'unsupported'}
                      onPress={() => void writeAndActivate()}
                    />
                  )}
                  <SecondaryButton
                    label={busyId ? 'Отменить проверку' : 'Продолжить позже'}
                    onPress={busyId ? cancelScan : closeEnrollment}
                  />
                  {!busyId && (
                    <Text style={[styles.caption, { color: palette.text.tertiary }]}>
                      Уже записанную метку можно активировать из списка. Если она осталась пустой, отзовите её и
                      создайте новую.
                    </Text>
                  )}
                </>
              ) : (
                <>
                  <Text accessibilityRole="header" style={[styles.heading, { color: palette.text.primary }]}>
                    Добавить метку
                  </Text>
                  <Text style={[styles.body, { color: palette.text.secondary }]}>
                    Дайте метке имя, чтобы отличать её в списке.
                  </Text>
                  <TextInput
                    accessibilityLabel="Название новой NFC-метки"
                    value={name}
                    onChangeText={setName}
                    placeholder="Например, Вход в мастерскую"
                    placeholderTextColor={palette.text.tertiary}
                    style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                    maxLength={80}
                    editable={!creating}
                  />
                  <PrimaryButton
                    label={creating ? 'Подготавливаем…' : 'Продолжить'}
                    disabled={creating || !name.trim()}
                    onPress={() => void createTag()}
                  />
                  {createFailed && (
                    <Text accessibilityLiveRegion="polite" style={styles.error}>
                      Не удалось подготовить метку. Проверьте интернет и повторите.
                    </Text>
                  )}
                </>
              )}
            </View>
            <Text accessibilityRole="header" style={[styles.listHeading, { color: palette.text.primary }]}>
              Метки этой точки
            </Text>

            {(tagsQuery.data ?? []).map((tag) => (
              <View
                key={tag.id}
                style={[styles.panel, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <Text
                  style={[
                    styles.status,
                    { color: tag.status === 'active' ? palette.accent.primaryText : palette.text.secondary },
                  ]}
                >
                  {tagStatus(tag)}
                </Text>
                <Text style={[styles.heading, { color: palette.text.primary }]}>{tag.name}</Text>
                {renamingId === tag.id && tag.status !== 'revoked' && (
                  <TextInput
                    accessibilityLabel="Название NFC-метки"
                    value={renameValues[tag.id] ?? tag.name}
                    onChangeText={(value) => setRenameValues((current) => ({ ...current, [tag.id]: value }))}
                    style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                    maxLength={80}
                  />
                )}
                <View style={styles.row}>
                  {tag.status === 'pending' && tag.id !== enrollmentTag?.id && (
                    <SecondaryButton
                      label="Завершить активацию"
                      disabled={!!enrollmentTag || !!busyId}
                      onPress={() => {
                        setRecoveryTag(tag);
                        setPhase('ready');
                        setNotice(null);
                        setReplacement(null);
                      }}
                    />
                  )}
                  {tag.status !== 'revoked' && (
                    <SecondaryButton
                      label={renamingId === tag.id ? 'Сохранить имя' : 'Переименовать'}
                      disabled={
                        !!busyId ||
                        renameMutation.isPending ||
                        (renamingId === tag.id && !(renameValues[tag.id] ?? tag.name).trim())
                      }
                      onPress={() => {
                        if (renamingId !== tag.id) {
                          setRenamingId(tag.id);
                          return;
                        }
                        renameMutation.mutate(
                          { id: tag.id, value: renameValues[tag.id] ?? tag.name },
                          { onSuccess: () => setRenamingId(null) },
                        );
                      }}
                    />
                  )}
                  {tag.status !== 'revoked' && (
                    <SecondaryButton
                      label="Отозвать"
                      disabled={!!busyId || revokeMutation.isPending}
                      onPress={() =>
                        Alert.alert('Отозвать метку?', 'Она больше не будет отмечать присутствие.', [
                          { text: 'Отмена', style: 'cancel' },
                          { text: 'Отозвать', style: 'destructive', onPress: () => revokeMutation.mutate(tag.id) },
                        ])
                      }
                    />
                  )}
                  {tag.status === 'revoked' && (
                    <SecondaryButton
                      label="Убрать из списка"
                      disabled={!!busyId || archiveMutation.isPending}
                      onPress={() =>
                        Alert.alert(
                          'Убрать отозванную метку?',
                          'Записи отметок и история восстановления сохранятся. Метка исчезнет из списка.',
                          [
                            { text: 'Отмена', style: 'cancel' },
                            { text: 'Убрать', style: 'destructive', onPress: () => archiveMutation.mutate(tag.id) },
                          ],
                        )
                      }
                    />
                  )}
                </View>
              </View>
            ))}
            {(renameMutation.isError || revokeMutation.isError || archiveMutation.isError) && (
              <Text style={styles.error}>Не удалось сохранить изменение. Проверьте интернет и повторите действие.</Text>
            )}
            {tagsQuery.data?.length === 0 && (
              <Text style={[styles.body, { color: palette.text.secondary }]}>Метки ещё не созданы.</Text>
            )}
          </>
        )}
      </ScreenSectionScrollView>
    </View>
  );
}

function Retry({ onPress }: { onPress: () => void }) {
  return <SecondaryButton label="Повторить загрузку" onPress={onPress} />;
}
function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const palette = useColors();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.primary, { backgroundColor: palette.accent.primary }, disabled && styles.disabled]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </TouchableOpacity>
  );
}
function SecondaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const palette = useColors();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.secondary, disabled && styles.disabled]}
    >
      <Text style={[styles.secondaryText, { color: palette.accent.primaryText }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing[4], gap: spacing[4] },
  panel: { borderWidth: StyleSheet.hairlineWidth, borderRadius: borderRadius.lg, padding: spacing[4], gap: spacing[3] },
  heading: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  body: { fontSize: fontSize.base, lineHeight: 23 },
  listHeading: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold, marginTop: spacing[3] },
  progress: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[2] },
  progressText: { flexShrink: 1, fontSize: fontSize.base, fontWeight: fontWeight.medium },
  caption: { fontSize: fontSize.xs, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: fontSize.base,
  },
  primary: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    alignItems: 'center',
  },
  primaryText: { color: '#fff', fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  secondary: {
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    alignItems: 'center',
  },
  secondaryText: { color: colors.primary[700], fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  disabled: { opacity: 0.45 },
  row: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  status: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  error: { color: colors.red[600], fontSize: fontSize.sm },
});
