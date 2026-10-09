import React, { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import QueryErrorState from '../components/QueryErrorState';
import { useAuth } from '../contexts/AuthContext';
import { createBookingsApi, createClientsApi } from '../../../shared/api/createServices';
import { createSessionBoundClient } from '../api/axios';
import { useColors } from '../contexts/ThemeContext';
import { colors, spacing, borderRadius } from '../theme';
import type { StaffPublicBookingRequest } from '../../../shared/types';
import { showMutationErrorToast } from '../components/Toast';

export default function PublicBookingRequestsScreen({ embedded = false }: { embedded?: boolean }) {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const queryClient = useQueryClient();
  const { user, token, hasPermission } = useAuth();
  const canReview = hasPermission('bookings_access');
  const sessionClient = useMemo(() => (token ? createSessionBoundClient(token) : null), [token]);
  const scopedBookingsApi = useMemo(() => (sessionClient ? createBookingsApi(sessionClient) : null), [sessionClient]);
  const scopedClientsApi = useMemo(() => (sessionClient ? createClientsApi(sessionClient) : null), [sessionClient]);
  const ownerScope = `${user?.id ?? ''}:${user?.currentPointId ?? ''}`;
  const decisionKeys = useRef(new Map<string, { accept: boolean; requestId: string }>());
  useEffect(() => {
    decisionKeys.current.clear();
  }, [ownerScope]);
  const requestsQuery = useQuery<StaffPublicBookingRequest[]>({
    queryKey: ['bookings', 'public-requests', ownerScope, 'pending'],
    queryFn: async () => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return (await scopedBookingsApi.requests()).data;
    },
    enabled: canReview && !!scopedBookingsApi,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['bookings', 'public-requests'] });
  const decide = useMutation({
    mutationFn: ({ request, accept }: { request: StaffPublicBookingRequest; accept: boolean }) => {
      const intent = decisionKeys.current.get(request.id);
      if (intent && intent.accept !== accept) throw new Error('Повторите выбранное действие или обновите список.');
      const requestId = intent?.requestId ?? Crypto.randomUUID();
      decisionKeys.current.set(request.id, { accept, requestId });
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return accept
        ? scopedBookingsApi.approve(request.id, { requestId })
        : scopedBookingsApi.reject(request.id, { requestId });
    },
    onSuccess: (_result, variables) => {
      decisionKeys.current.delete(variables.request.id);
      void refresh();
    },
    onError: showMutationErrorToast,
  });
  const linkClient = useMutation({
    mutationFn: async (request: StaffPublicBookingRequest) => {
      if (!request.bookingId || !scopedClientsApi || !scopedBookingsApi) throw new Error('Сначала подтвердите запись.');
      const candidate = await scopedClientsApi.lookupByPhone(request.phone);
      if (!candidate.data) throw new Error('В выбранной точке не найдена подходящая карточка клиента.');
      return scopedBookingsApi.linkClient(request.bookingId, {
        requestId: Crypto.randomUUID(),
        clientId: candidate.data.id,
      });
    },
    onSuccess: () => void refresh(),
    onError: showMutationErrorToast,
  });

  return (
    <View style={[embedded ? styles.embedded : styles.safe, { backgroundColor: palette.bg.canvas }]}>
      {!embedded && <IosScreenHeader title="Заявки онлайн-записи" onBack={() => navigation.goBack()} />}
      {!canReview ? (
        <QueryErrorState
          title="Нет доступа"
          description="Для обработки заявок нужно право доступа к записям."
          onRetry={() => navigation.goBack()}
        />
      ) : requestsQuery.isLoading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary[600]} />
      ) : requestsQuery.isError ? (
        <QueryErrorState
          title="Не удалось загрузить заявки"
          description="Проверьте подключение и повторите попытку."
          onRetry={() => void requestsQuery.refetch()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={[styles.hint, { color: palette.text.secondary }]}>
            Неподтверждённые заявки не занимают время сотрудника. Подтвердите запись, когда проверите возможность
            принять клиента.
          </Text>
          {(requestsQuery.data ?? []).filter((request) => request.status === 'pending' || request.needsClientLink)
            .length === 0 ? (
            <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              <Text style={[styles.title, { color: palette.text.primary }]}>Новых заявок нет</Text>
            </View>
          ) : (
            requestsQuery.data
              ?.filter((request) => request.status === 'pending' || request.needsClientLink)
              .map((request) => (
                <View
                  key={request.id}
                  style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                >
                  <Text style={[styles.title, { color: palette.text.primary }]}>{request.name}</Text>
                  <Text style={[styles.body, { color: palette.text.secondary }]}>
                    {request.phone} · {new Date(request.startsAt).toLocaleString('ru-RU')}
                  </Text>
                  {request.services.map((service) => (
                    <Text key={service.serviceId} style={[styles.body, { color: palette.text.secondary }]}>
                      {service.name} · {service.durationMinutes} мин
                    </Text>
                  ))}
                  {!!request.comment && (
                    <Text style={[styles.body, { color: palette.text.secondary, marginTop: spacing[2] }]}>
                      {request.comment}
                    </Text>
                  )}
                  {request.status === 'pending' && (
                    <View style={styles.actions}>
                      <Action
                        label="Подтвердить"
                        disabled={decide.isPending || decisionKeys.current.get(request.id)?.accept === false}
                        onPress={() => decide.mutate({ request, accept: true })}
                        primary
                      />
                      <Action
                        label="Отклонить"
                        disabled={decide.isPending || decisionKeys.current.get(request.id)?.accept === true}
                        onPress={() => decide.mutate({ request, accept: false })}
                      />
                    </View>
                  )}
                  {request.needsClientLink && request.bookingId && (
                    <View style={styles.linkBox}>
                      <Text style={[styles.body, { color: palette.text.secondary }]}>
                        Для отметки прихода сначала свяжите запись с существующей карточкой клиента этой точки.
                      </Text>
                      <Action
                        label={linkClient.isPending ? 'Ищем карточку…' : 'Найти по телефону и связать'}
                        disabled={linkClient.isPending}
                        onPress={() => linkClient.mutate(request)}
                      />
                    </View>
                  )}
                </View>
              ))
          )}
          <TouchableOpacity onPress={() => void requestsQuery.refetch()} style={styles.refresh}>
            <Text style={styles.refreshText}>Обновить список</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </View>
  );
}

function Action({
  label,
  disabled,
  onPress,
  primary,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, primary && styles.primaryButton, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  embedded: { flex: 1 },
  loader: { marginTop: 48 },
  content: { padding: spacing[4], paddingBottom: spacing[10] },
  hint: { fontSize: 14, lineHeight: 21, marginBottom: spacing[4] },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    marginBottom: spacing[3],
  },
  title: { fontSize: 17, fontWeight: '700', marginBottom: spacing[1] },
  body: { fontSize: 14, lineHeight: 20, marginTop: spacing[1] },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[4] },
  linkBox: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
    marginTop: spacing[4],
    paddingTop: spacing[3],
    gap: spacing[2],
  },
  button: {
    minHeight: 42,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
  },
  primaryButton: { backgroundColor: colors.primary[600], borderColor: colors.primary[600] },
  buttonText: { color: colors.gray[800], fontSize: 14, fontWeight: '600' },
  primaryText: { color: colors.white },
  disabled: { opacity: 0.55 },
  refresh: { alignItems: 'center', padding: spacing[4] },
  refreshText: { color: colors.primary[700], fontWeight: '600' },
});
