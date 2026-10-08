import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import QueryErrorState from '../components/QueryErrorState';
import { useAuth } from '../contexts/AuthContext';
import { createBookingsApi, createServicesApi } from '../../../shared/api/createServices';
import { createSessionBoundClient } from '../api/axios';
import { useColors } from '../contexts/ThemeContext';
import { colors, spacing, borderRadius } from '../theme';
import type { PublicBookingPageSettings, PublicBookingResource } from '../../../shared/types';
import type { PutPublicBookingSettingsRequest } from '../../../shared/api/types';
import { showMutationErrorToast } from '../components/Toast';

export default function PublicBookingSettingsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const queryClient = useQueryClient();
  const { user, token, hasPermission } = useAuth();
  const canManage = hasPermission('company_manage');
  const sessionClient = useMemo(() => (token ? createSessionBoundClient(token) : null), [token]);
  const scopedBookingsApi = useMemo(() => (sessionClient ? createBookingsApi(sessionClient) : null), [sessionClient]);
  const scopedServicesApi = useMemo(() => (sessionClient ? createServicesApi(sessionClient) : null), [sessionClient]);
  const ownerScope = `${user?.id ?? ''}:${user?.currentPointId ?? ''}`;
  const [draft, setDraft] = useState<Partial<PutPublicBookingSettingsRequest>>({});
  const settingsQuery = useQuery<PublicBookingPageSettings | null>({
    queryKey: ['bookings', 'public-settings', ownerScope],
    queryFn: async () => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return (await scopedBookingsApi.getPublicSettings()).data;
    },
    enabled: canManage && !!scopedBookingsApi,
  });
  const resourcesQuery = useQuery<PublicBookingResource[]>({
    queryKey: ['bookings', 'public-resources', ownerScope],
    queryFn: async () => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return (await scopedBookingsApi.publicResources()).data;
    },
    enabled: canManage && !!scopedBookingsApi,
  });
  const servicesQuery = useQuery({
    queryKey: ['bookings', 'public-service-options', ownerScope],
    queryFn: async () => {
      if (!scopedServicesApi) throw new Error('Нет активной сессии');
      return (await scopedServicesApi.getAll({ page: 1, limit: 500 })).data;
    },
    enabled: canManage && !!scopedServicesApi,
  });
  const settings = settingsQuery.data;
  const services = servicesQuery.data?.data ?? [];
  const resources = resourcesQuery.data ?? [];
  const [slug, setSlug] = useState('');
  const value = useMemo(
    () => ({
      displayName: draft.displayName ?? settings?.displayName ?? '',
      address: draft.address ?? settings?.address ?? '',
      contacts: draft.contacts ?? settings?.contacts ?? '',
      showPrices: draft.showPrices ?? settings?.showPrices ?? false,
      mode: draft.mode ?? settings?.mode ?? 'approval',
      operator: draft.operator ?? settings?.operator ?? { name: '', requisites: '', contact: '' },
      policyText: draft.policyText ?? settings?.policyText ?? '',
      consentText: draft.consentText ?? settings?.consentText ?? '',
      serviceRows: draft.services ?? settings?.services ?? [],
      resourceIds: draft.resourceIds ?? settings?.resourceIds ?? [],
    }),
    [draft, settings],
  );

  const save = useMutation({
    mutationFn: (body: PutPublicBookingSettingsRequest) => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return scopedBookingsApi.putPublicSettings(body);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['bookings', 'public-settings', ownerScope], result.data);
      setDraft({});
      setSlug(result.data.slug);
    },
    onError: showMutationErrorToast,
  });
  const publish = useMutation({
    mutationFn: (next: boolean) => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return next
        ? scopedBookingsApi.unpublish({ requestId: Crypto.randomUUID() })
        : scopedBookingsApi.publish({ requestId: Crypto.randomUUID() });
    },
    onSuccess: (result) => queryClient.setQueryData(['bookings', 'public-settings', ownerScope], result.data),
    onError: showMutationErrorToast,
  });
  const setOperator = (field: 'name' | 'requisites' | 'contact', text: string) =>
    setDraft((current) => ({ operator: { ...value.operator, ...current.operator, [field]: text } }));
  const setText = (field: 'displayName' | 'address' | 'contacts' | 'policyText' | 'consentText', text: string) =>
    setDraft((current) => ({ ...current, [field]: text }));
  const toggleService = (id: string, enabled: boolean) =>
    setDraft((current) => {
      const currentRows = current.services ?? settings?.services ?? [];
      return {
        ...current,
        services: enabled
          ? [...currentRows, { serviceId: id, durationMinutes: 90 }]
          : currentRows.filter((row) => row.serviceId !== id),
      };
    });
  const toggleResource = (id: string, enabled: boolean) =>
    setDraft((current) => {
      const currentIds = current.resourceIds ?? settings?.resourceIds ?? [];
      return { ...current, resourceIds: enabled ? [...currentIds, id] : currentIds.filter((item) => item !== id) };
    });
  const setDayHours = (day: string, hours: { start: string; end: string } | null) =>
    setDraft((current) => ({
      ...current,
      openingHours: { ...(current.openingHours ?? settings?.openingHours ?? {}), [day]: hours },
    }));

  const submit = () => {
    const pageSlug =
      settings?.slug ??
      slug
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '');
    if (!pageSlug) return;
    save.mutate({
      requestId: Crypto.randomUUID(),
      revision: settings?.revision ?? 0,
      slug: pageSlug,
      displayName: value.displayName,
      address: value.address,
      contacts: value.contacts,
      showPrices: value.showPrices,
      mode: value.mode,
      operator: value.operator,
      policyText: value.policyText,
      consentText: value.consentText,
      services: value.serviceRows,
      resourceIds: value.resourceIds,
      slotStepMinutes: draft.slotStepMinutes ?? settings?.slotStepMinutes ?? 15,
      ...(draft.openingHours
        ? { openingHours: draft.openingHours }
        : settings
          ? { openingHours: settings.openingHours }
          : {}),
    });
  };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Страница записи" onBack={() => navigation.goBack()} />
      {!canManage ? (
        <QueryErrorState
          title="Нет доступа"
          description="Управлять публичной страницей может владелец автосервиса."
          onRetry={() => navigation.goBack()}
        />
      ) : settingsQuery.isLoading ? (
        <ActivityIndicator style={styles.loader} color={colors.primary[600]} />
      ) : settingsQuery.isError ? (
        <QueryErrorState
          title="Не удалось загрузить настройки"
          description="Проверьте подключение и повторите попытку."
          onRetry={() => void settingsQuery.refetch()}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {!settings && (
            <>
              <Text style={[styles.label, { color: palette.text.secondary }]}>Короткая ссылка</Text>
              <TextInput
                value={slug}
                onChangeText={(text) =>
                  setSlug(
                    text
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, '')
                      .slice(0, 80),
                  )
                }
                autoCapitalize="none"
                style={[
                  styles.input,
                  { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                ]}
                placeholder="например, garage-center"
              />
              <Text style={[styles.note, { color: palette.text.tertiary }]}>
                После сохранения адрес нельзя будет изменить.
              </Text>
            </>
          )}
          <Text style={[styles.label, { color: palette.text.secondary }]}>Название сервиса</Text>
          <TextInput
            value={value.displayName}
            onChangeText={(text) => setText('displayName', text)}
            style={[
              styles.input,
              { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
            maxLength={160}
          />
          <Text style={[styles.label, { color: palette.text.secondary }]}>Адрес</Text>
          <TextInput
            value={value.address}
            onChangeText={(text) => setText('address', text)}
            style={[
              styles.input,
              { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
            maxLength={300}
          />
          <Text style={[styles.label, { color: palette.text.secondary }]}>Контакты сервиса</Text>
          <TextInput
            value={value.contacts}
            onChangeText={(text) => setText('contacts', text)}
            style={[
              styles.input,
              { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
            maxLength={300}
          />
          <Text style={[styles.section, { color: palette.text.primary }]}>Исполнитель</Text>
          {(['name', 'requisites', 'contact'] as const).map((field) => (
            <TextInput
              key={field}
              value={value.operator[field]}
              onChangeText={(text) => setOperator(field, text)}
              placeholder={
                field === 'name'
                  ? 'Наименование исполнителя'
                  : field === 'requisites'
                    ? 'Реквизиты'
                    : 'Контакт исполнителя'
              }
              style={[
                styles.input,
                { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              ]}
              maxLength={500}
            />
          ))}
          <View style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <Text style={[styles.rowTitle, { color: palette.text.primary }]}>Подтверждать автоматически</Text>
            <Switch
              value={value.mode === 'instant'}
              onValueChange={(enabled) =>
                setDraft((current) => ({ ...current, mode: enabled ? 'instant' : 'approval' }))
              }
            />
          </View>
          <View style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <Text style={[styles.rowTitle, { color: palette.text.primary }]}>Показывать цены</Text>
            <Switch
              value={value.showPrices}
              onValueChange={(enabled) => setDraft((current) => ({ ...current, showPrices: enabled }))}
            />
          </View>
          <Text style={[styles.section, { color: palette.text.primary }]}>Шаг времени (минуты)</Text>
          <TextInput
            keyboardType="number-pad"
            value={String(draft.slotStepMinutes ?? settings?.slotStepMinutes ?? 15)}
            onChangeText={(text) => setDraft((current) => ({ ...current, slotStepMinutes: Number(text) }))}
            style={[
              styles.input,
              { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
          />
          <Text style={[styles.section, { color: palette.text.primary }]}>Рабочие часы</Text>
          {['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'].map((label, index) => {
            const day = String(index);
            const hours = (draft.openingHours ?? settings?.openingHours ?? {})[day] ?? null;
            return (
              <View
                key={day}
                style={[styles.hoursRow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <Switch
                  value={!!hours}
                  onValueChange={(enabled) => setDayHours(day, enabled ? { start: '09:00', end: '18:00' } : null)}
                />
                <Text style={[styles.hoursLabel, { color: palette.text.primary }]}>{label}</Text>
                {hours && (
                  <>
                    <TextInput
                      accessibilityLabel={`${label}: начало`}
                      value={hours.start}
                      onChangeText={(start) => setDayHours(day, { ...hours, start })}
                      style={[styles.timeInput, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                    />
                    <Text style={{ color: palette.text.secondary }}>—</Text>
                    <TextInput
                      accessibilityLabel={`${label}: окончание`}
                      value={hours.end}
                      onChangeText={(end) => setDayHours(day, { ...hours, end })}
                      style={[styles.timeInput, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                    />
                  </>
                )}
              </View>
            );
          })}
          <Text style={[styles.section, { color: palette.text.primary }]}>Условия и согласие</Text>
          <TextInput
            value={value.policyText}
            onChangeText={(text) => setText('policyText', text)}
            placeholder="Политика обработки данных"
            multiline
            style={[
              styles.input,
              styles.multiline,
              { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
          />
          <TextInput
            value={value.consentText}
            onChangeText={(text) => setText('consentText', text)}
            placeholder="Текст согласия"
            multiline
            style={[
              styles.input,
              styles.multiline,
              { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
          />
          <Text style={[styles.section, { color: palette.text.primary }]}>Услуги</Text>
          {servicesQuery.isError ? (
            <Text style={styles.error}>Не удалось загрузить каталог услуг. Повторите загрузку.</Text>
          ) : (
            services.map((service) => {
              const chosen = value.serviceRows.find((item) => item.serviceId === service.id);
              return (
                <View
                  key={service.id}
                  style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                >
                  <Text style={[styles.rowTitle, { color: palette.text.primary }]}>{service.name}</Text>
                  {chosen && (
                    <TextInput
                      accessibilityLabel={`Длительность услуги ${service.name}`}
                      keyboardType="number-pad"
                      value={String(chosen.durationMinutes)}
                      onChangeText={(text) =>
                        setDraft((current) => ({
                          ...current,
                          services: (current.services ?? settings?.services ?? []).map((item) =>
                            item.serviceId === service.id ? { ...item, durationMinutes: Number(text) } : item,
                          ),
                        }))
                      }
                      style={[styles.duration, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                    />
                  )}
                  <Switch value={!!chosen} onValueChange={(enabled) => toggleService(service.id, enabled)} />
                </View>
              );
            })
          )}
          <Text style={[styles.section, { color: palette.text.primary }]}>Сотрудники</Text>
          {resourcesQuery.isError ? (
            <Text style={styles.error}>Не удалось загрузить сотрудников. Повторите загрузку.</Text>
          ) : (
            resources.map((resource) => (
              <View
                key={resource.id}
                style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <Text style={[styles.rowTitle, { color: palette.text.primary }]}>{resource.name}</Text>
                <Switch
                  value={value.resourceIds.includes(resource.id)}
                  onValueChange={(enabled) => toggleResource(resource.id, enabled)}
                />
              </View>
            ))
          )}
          <TouchableOpacity
            accessibilityRole="button"
            disabled={save.isPending || (!settings && !slug.trim())}
            onPress={submit}
            style={[styles.button, (save.isPending || (!settings && !slug.trim())) && styles.disabled]}
          >
            <Text style={styles.buttonText}>{save.isPending ? 'Сохраняем…' : 'Сохранить страницу'}</Text>
          </TouchableOpacity>
          {settings && (
            <TouchableOpacity
              accessibilityRole="button"
              disabled={publish.isPending}
              onPress={() => publish.mutate(settings.published)}
              style={[styles.button, styles.secondary]}
            >
              <Text style={[styles.buttonText, styles.secondaryText]}>
                {settings.published ? 'Снять с публикации' : 'Опубликовать страницу'}
              </Text>
            </TouchableOpacity>
          )}
          {settings?.slug && (
            <>
              <Text selectable style={[styles.note, { color: palette.text.secondary }]}>
                https://autexa.pw/book/{settings.slug}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => void Share.share({ message: `https://autexa.pw/book/${settings.slug}` })}
                style={[styles.button, styles.secondary]}
              >
                <Text style={[styles.buttonText, styles.secondaryText]}>Скопировать или отправить ссылку</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  loader: { marginTop: 48 },
  content: { padding: spacing[4], paddingBottom: spacing[10] },
  label: { fontSize: 13, fontWeight: '600', marginTop: spacing[3], marginBottom: spacing[1] },
  input: { minHeight: 48, borderWidth: 1, borderRadius: borderRadius.md, paddingHorizontal: spacing[3], fontSize: 15 },
  multiline: { minHeight: 100, paddingTop: spacing[3], textAlignVertical: 'top', marginBottom: spacing[2] },
  note: { fontSize: 12, lineHeight: 18, marginTop: spacing[1], marginBottom: spacing[2] },
  section: { fontSize: 16, fontWeight: '700', marginTop: spacing[5], marginBottom: spacing[2] },
  row: {
    minHeight: 54,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[3],
    marginBottom: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowTitle: { flex: 1, fontSize: 14, fontWeight: '500' },
  hoursRow: {
    minHeight: 54,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    marginBottom: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  hoursLabel: { flex: 1, fontSize: 12 },
  timeInput: { width: 70, height: 38, borderWidth: 1, borderRadius: borderRadius.sm, textAlign: 'center' },
  duration: {
    width: 62,
    height: 38,
    borderWidth: 1,
    borderRadius: borderRadius.sm,
    textAlign: 'center',
    marginRight: spacing[2],
  },
  button: {
    minHeight: 48,
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing[4],
  },
  buttonText: { color: colors.white, fontWeight: '700' },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary[600] },
  secondaryText: { color: colors.primary[700] },
  disabled: { opacity: 0.55 },
  error: { color: colors.red[700], paddingVertical: spacing[2] },
});
