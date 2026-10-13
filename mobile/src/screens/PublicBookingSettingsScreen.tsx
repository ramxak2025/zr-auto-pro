import React, { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import QueryErrorState from '../components/QueryErrorState';
import { useAuth } from '../contexts/AuthContext';
import { createBookingsApi } from '../../../shared/api/createServices';
import { createSessionBoundClient, getImageUrl, captureAuthSession } from '../api/axios';
import { useColors } from '../contexts/ThemeContext';
import { colors, spacing, borderRadius } from '../theme';
import type {
  PublicBookingContactLinks,
  PublicBookingPageSettings,
  PublicBookingResource,
  PublicBookingServiceOption,
} from '../../../shared/types';
import type { PutPublicBookingSettingsRequest } from '../../../shared/api/types';
import { showMutationErrorToast } from '../components/Toast';
import { TabBarScrollView as ScrollView } from '../components/TabBarScrollable';

const WEEK_DAYS = [
  { key: '1', short: 'Пн', label: 'Понедельник' },
  { key: '2', short: 'Вт', label: 'Вторник' },
  { key: '3', short: 'Ср', label: 'Среда' },
  { key: '4', short: 'Чт', label: 'Четверг' },
  { key: '5', short: 'Пт', label: 'Пятница' },
  { key: '6', short: 'Сб', label: 'Суббота' },
  { key: '0', short: 'Вс', label: 'Воскресенье' },
] as const;
const DEFAULT_HOURS = Object.fromEntries(
  Array.from({ length: 7 }, (_, day) => [String(day), { start: '09:00', end: '18:00' }]),
);

export default function PublicBookingSettingsScreen({ embedded = false }: { embedded?: boolean }) {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const queryClient = useQueryClient();
  const { user, token, hasPermission } = useAuth();
  const canManage = hasPermission('company_manage');
  const sessionClient = useMemo(() => (token ? createSessionBoundClient(token) : null), [token]);
  const scopedBookingsApi = useMemo(() => (sessionClient ? createBookingsApi(sessionClient) : null), [sessionClient]);
  const ownerScope = `${user?.id ?? ''}:${user?.currentPointId ?? ''}`;
  const [draft, setDraft] = useState<Partial<PutPublicBookingSettingsRequest>>({});
  const sessionRef = useRef({ ownerScope, token });
  sessionRef.current = { ownerScope, token };
  const uploadSequence = useRef(0);
  useEffect(() => {
    uploadSequence.current += 1;
    setUploadingBranding(null);
  }, [token]);
  const [uploadingBranding, setUploadingBranding] = useState<'logoUrl' | 'backgroundImageUrl' | null>(null);
  const [activeDay, setActiveDay] = useState('1');
  useEffect(() => {
    setDraft({});
    uploadSequence.current += 1;
    setUploadingBranding(null);
    setActiveDay('1');
  }, [ownerScope]);
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
  const servicesQuery = useQuery<PublicBookingServiceOption[]>({
    queryKey: ['bookings', 'public-service-options', ownerScope],
    queryFn: async () => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      const all: PublicBookingServiceOption[] = [];
      let page = 1;
      let total = 0;
      do {
        const result = (await scopedBookingsApi.publicServices({ page, limit: 500 })).data;
        all.push(...result.data);
        total = result.total;
        if (result.data.length === 0 && all.length < total)
          throw new Error('Не удалось загрузить весь список услуг. Повторите попытку.');
        page += 1;
        if (page > 10000) throw new Error('Слишком большой каталог услуг для загрузки.');
      } while (all.length < total);
      return all;
    },
    enabled: canManage && !!scopedBookingsApi,
  });
  const settings = settingsQuery.data;
  const publicUrl = settings?.publicUrl;
  const services = servicesQuery.data ?? [];
  const resources = resourcesQuery.data ?? [];
  const value = useMemo(
    () => ({
      logoUrl: draft.logoUrl !== undefined ? draft.logoUrl : (settings?.logoUrl ?? null),
      backgroundImageUrl:
        draft.backgroundImageUrl !== undefined ? draft.backgroundImageUrl : (settings?.backgroundImageUrl ?? null),
      displayName: draft.displayName ?? settings?.displayName ?? user?.tenant?.name ?? '',
      address: draft.address ?? settings?.address ?? user?.tenant?.address ?? '',
      contacts:
        draft.contacts ?? settings?.contacts ?? [user?.tenant?.phone, user?.tenant?.email].filter(Boolean).join(' · '),
      showPrices: draft.showPrices ?? settings?.showPrices ?? false,
      mode: draft.mode ?? settings?.mode ?? 'approval',
      links: draft.links ?? settings?.links ?? (user?.tenant?.phone ? { phone: user.tenant.phone } : {}),
      serviceRows: draft.services ?? settings?.services ?? [],
      resourceIds: draft.resourceIds ?? settings?.resourceIds ?? [],
      openingHours: draft.openingHours ?? settings?.openingHours ?? DEFAULT_HOURS,
    }),
    [draft, settings, user?.tenant],
  );

  const save = useMutation({
    mutationFn: (body: PutPublicBookingSettingsRequest) => {
      if (!scopedBookingsApi) throw new Error('Нет активной сессии');
      return scopedBookingsApi.putPublicSettings(body);
    },
    onSuccess: (result) => {
      if (sessionRef.current.ownerScope !== ownerScope || sessionRef.current.token !== token) return;
      queryClient.setQueryData(['bookings', 'public-settings', ownerScope], result.data);
      setDraft({});
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
  const uploadBranding = async (field: 'logoUrl' | 'backgroundImageUrl') => {
    if (!scopedBookingsApi || !canManage || uploadingBranding) return;
    const sequence = ++uploadSequence.current;
    const auth = captureAuthSession();
    const current = () =>
      auth.isCurrent() &&
      sessionRef.current.ownerScope === ownerScope &&
      sessionRef.current.token === token &&
      sequence === uploadSequence.current;
    setUploadingBranding(field);
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (picked.canceled || !current()) return;
      const asset = picked.assets[0];
      let upload = {
        uri: asset.uri,
        name: asset.fileName ?? 'branding.jpg',
        type: asset.mimeType?.toLowerCase() ?? 'application/octet-stream',
      };
      // iPhone libraries may still provide an original HEIC despite the
      // compatible picker request. Convert it locally; the server accepts only
      // bounded raster JPEG/PNG/WebP and validates the actual uploaded bytes.
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(upload.type)) {
        const compatible = await ImageManipulator.manipulateAsync(asset.uri, [], {
          format: ImageManipulator.SaveFormat.JPEG,
          compress: 0.9,
        });
        if (!current()) return;
        upload = { uri: compatible.uri, name: 'branding.jpg', type: 'image/jpeg' };
      } else if (asset.fileSize && asset.fileSize > 5 * 1024 * 1024) {
        throw new Error('Изображение должно быть до 5 МБ');
      }
      const form = new FormData();
      // RN's native FormData accepts a URI descriptor; its DOM typing exposes Blob only.
      form.append('file', upload as unknown as Blob);
      const response = await scopedBookingsApi.uploadPublicBranding(form);
      if (current()) setDraft((previous) => ({ ...previous, [field]: response.data.url }));
    } catch (error) {
      if (current()) showMutationErrorToast(error);
    } finally {
      if (current()) setUploadingBranding(null);
    }
  };
  const setText = (field: 'displayName' | 'address' | 'contacts', text: string) =>
    setDraft((current) => ({ ...current, [field]: text }));
  const setPublicLink = (key: keyof PublicBookingContactLinks, text: string) =>
    setDraft((current) => ({
      ...current,
      links: { ...value.links, ...current.links, [key]: text },
      ...(key === 'phone' ? { contacts: [text, user?.tenant?.email].filter(Boolean).join(' · ') } : {}),
    }));
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
      openingHours: { ...value.openingHours, [day]: hours },
    }));

  const submit = () => {
    save.mutate({
      requestId: Crypto.randomUUID(),
      revision: settings?.revision ?? 0,
      logoUrl: value.logoUrl,
      backgroundImageUrl: value.backgroundImageUrl,
      displayName: value.displayName,
      address: value.address,
      contacts: value.contacts,
      links: value.links,
      showPrices: value.showPrices,
      mode: value.mode,
      services: value.serviceRows,
      resourceIds: value.resourceIds,
      slotStepMinutes: draft.slotStepMinutes ?? settings?.slotStepMinutes ?? 15,
      openingHours: value.openingHours,
    });
  };

  return (
    <View style={[embedded ? styles.embedded : styles.safe, { backgroundColor: palette.bg.canvas }]}>
      {!embedded && <IosScreenHeader title="Страница записи" onBack={() => navigation.goBack()} />}
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
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.intro}>
            <Text style={[styles.introTitle, { color: palette.text.primary }]}>Запись к вам</Text>
            <Text style={[styles.note, { color: palette.text.secondary }]}>
              {settings?.published ? 'Страница опубликована' : 'Страница пока скрыта'}
            </Text>
            {publicUrl && (
              <Text selectable style={[styles.link, { color: colors.primary[700] }]}>
                {publicUrl}
              </Text>
            )}
          </View>
          <SettingsSection title="Оформление страницы" summary="Логотип и изображение шапки" initialOpen>
            {(
              [
                ['logoUrl', 'Логотип сервиса', value.logoUrl],
                ['backgroundImageUrl', 'Изображение шапки', value.backgroundImageUrl],
              ] as const
            ).map(([field, label, url]) => (
              <View key={field} style={styles.brandingRow}>
                {url ? (
                  <Image
                    source={{ uri: getImageUrl(url) }}
                    accessibilityLabel={label}
                    resizeMode={field === 'logoUrl' ? 'contain' : 'cover'}
                    style={[styles.brandingPreview, field === 'logoUrl' && styles.brandingLogo]}
                  />
                ) : (
                  <View style={[styles.brandingPreview, { backgroundColor: palette.bg.card }]} />
                )}
                <View style={styles.brandingControls}>
                  <Text style={[styles.label, { color: palette.text.primary }]}>{label}</Text>
                  <TouchableOpacity
                    accessibilityRole="button"
                    disabled={!!uploadingBranding}
                    onPress={() => void uploadBranding(field)}
                    style={styles.brandingAction}
                  >
                    <Text style={{ color: colors.primary[600] }}>
                      {uploadingBranding === field ? 'Загружаем…' : url ? 'Заменить' : 'Загрузить'}
                    </Text>
                  </TouchableOpacity>
                  {url && (
                    <TouchableOpacity
                      accessibilityRole="button"
                      disabled={!!uploadingBranding}
                      onPress={() => setDraft((previous) => ({ ...previous, [field]: null }))}
                      style={styles.brandingAction}
                    >
                      <Text style={{ color: palette.text.secondary }}>Удалить</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
            <Text style={[styles.note, { color: palette.text.secondary }]}>
              JPEG, PNG или WebP до 5 МБ. Изображения появятся у клиентов после сохранения страницы.
            </Text>
          </SettingsSection>
          <SettingsSection title="Автосервис" summary={value.displayName || 'Название и адрес'} initialOpen>
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
          </SettingsSection>
          <SettingsSection title="Контакты и соцсети" summary={value.links.phone || 'Как с вами связаться'}>
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
            <Text style={[styles.label, { color: palette.text.secondary }]}>Телефон для связи</Text>
            <TextInput
              accessibilityLabel="Телефон для связи"
              keyboardType="phone-pad"
              value={value.links.phone ?? ''}
              onChangeText={(text) => setPublicLink('phone', text)}
              style={[
                styles.input,
                { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              ]}
              maxLength={32}
            />
            {(
              [
                ['instagram', 'Instagram', 'https://instagram.com/...'],
                ['whatsapp', 'WhatsApp', 'https://wa.me/...'],
                ['vk', 'ВКонтакте', 'https://vk.com/...'],
                ['telegram', 'Telegram', 'https://t.me/...'],
              ] as const
            ).map(([key, label, placeholder]) => (
              <View key={key}>
                <Text style={[styles.label, { color: palette.text.secondary }]}>{label}</Text>
                <TextInput
                  accessibilityLabel={label}
                  value={value.links[key] ?? ''}
                  onChangeText={(text) => setPublicLink(key, text)}
                  placeholder={placeholder}
                  autoCapitalize="none"
                  keyboardType="url"
                  style={[
                    styles.input,
                    {
                      color: palette.text.primary,
                      backgroundColor: palette.bg.card,
                      borderColor: palette.border.subtle,
                    },
                  ]}
                  maxLength={500}
                />
              </View>
            ))}
          </SettingsSection>
          <SettingsSection
            title="Как проходит запись"
            summary={value.mode === 'instant' ? 'Сразу в расписание' : 'После вашего подтверждения'}
          >
            <Text style={[styles.note, { color: palette.text.secondary }]}>
              {value.mode === 'instant'
                ? 'Клиент выбирает свободное время — запись появляется в расписании.'
                : 'Клиент оставляет заявку — вы проверяете и подтверждаете время.'}
            </Text>
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
          </SettingsSection>
          <SettingsSection title="Расписание" summary="Рабочие дни и свободное время">
            <Text style={[styles.label, { color: palette.text.secondary }]}>Шаг времени (минуты)</Text>
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.daysTabs}>
              {WEEK_DAYS.map(({ key, short, label }) => (
                <TouchableOpacity
                  key={key}
                  accessibilityRole="tab"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: activeDay === key }}
                  onPress={() => setActiveDay(key)}
                  style={[styles.dayTab, activeDay === key && styles.dayTabActive]}
                >
                  <Text style={[styles.dayTabText, activeDay === key && styles.dayTabTextActive]}>{short}</Text>
                  <View style={[styles.dayDot, value.openingHours[key] && styles.dayDotOpen]} />
                </TouchableOpacity>
              ))}
            </ScrollView>
            {(() => {
              const day = WEEK_DAYS.find((item) => item.key === activeDay) ?? WEEK_DAYS[0];
              const hours = value.openingHours[day.key] ?? null;
              return (
                <View
                  style={[styles.hoursRow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                >
                  <Switch
                    value={!!hours}
                    onValueChange={(enabled) => setDayHours(day.key, enabled ? { start: '09:00', end: '18:00' } : null)}
                  />
                  <Text style={[styles.hoursLabel, { color: palette.text.primary }]}>{day.label}</Text>
                  {hours && (
                    <View style={styles.hoursTimeGroup}>
                      <TextInput
                        accessibilityLabel={`${day.label}: начало`}
                        value={hours.start}
                        onChangeText={(start) => setDayHours(day.key, { ...hours, start })}
                        style={[styles.timeInput, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                      />
                      <Text style={{ color: palette.text.secondary }}>—</Text>
                      <TextInput
                        accessibilityLabel={`${day.label}: окончание`}
                        value={hours.end}
                        onChangeText={(end) => setDayHours(day.key, { ...hours, end })}
                        style={[styles.timeInput, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                      />
                    </View>
                  )}
                </View>
              );
            })()}
          </SettingsSection>
          <SettingsSection title="Документы для клиента" summary="Политика и отдельное согласие">
            <View>
              <Text style={[styles.section, { color: palette.text.primary }]}>Политика и отдельное согласие</Text>
              <Text style={[styles.note, { color: palette.text.secondary }]}>
                Autexa готовит тексты из реквизитов компании. Клиент отмечает согласие вручную.
              </Text>
              {settings ? (
                <>
                  <Text style={[styles.note, { color: palette.text.primary }]}>
                    Политика · версия {settings.consentVersion}
                  </Text>
                  <Text selectable style={[styles.legalText, { color: palette.text.secondary }]}>
                    {settings.policyText}
                  </Text>
                  <Text style={[styles.note, { color: palette.text.primary }]}>Отдельное согласие</Text>
                  <Text selectable style={[styles.legalText, { color: palette.text.secondary }]}>
                    {settings.consentText}
                  </Text>
                </>
              ) : (
                <Text style={[styles.note, { color: palette.text.secondary }]}>
                  Тексты появятся после первого сохранения.
                </Text>
              )}
            </View>
          </SettingsSection>
          <SettingsSection title="Услуги" summary={`Выбрано: ${value.serviceRows.length}`}>
            <Text style={[styles.note, { color: palette.text.secondary }]}>
              Включите услуги и укажите длительность в минутах.
            </Text>
            {servicesQuery.isLoading ? (
              <Text style={[styles.note, { color: palette.text.secondary }]}>Загружаем каталог услуг…</Text>
            ) : servicesQuery.isError ? (
              <View>
                <Text style={styles.error}>Не удалось загрузить каталог услуг.</Text>
                <TouchableOpacity accessibilityRole="button" onPress={() => void servicesQuery.refetch()}>
                  <Text style={styles.retryText}>Повторить загрузку услуг</Text>
                </TouchableOpacity>
              </View>
            ) : services.length === 0 ? (
              <Text style={[styles.note, { color: palette.text.secondary }]}>В каталоге пока нет услуг.</Text>
            ) : (
              services.map((service) => {
                const chosen = value.serviceRows.find((item) => item.serviceId === service.id);
                return (
                  <View
                    key={service.id}
                    style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.rowTitle, { color: palette.text.primary }]}>{service.name}</Text>
                      {!!service.category && (
                        <Text style={[styles.note, { color: palette.text.tertiary }]}>{service.category}</Text>
                      )}
                    </View>
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
          </SettingsSection>
          <SettingsSection title="Мастера" summary={`Принимают записи: ${value.resourceIds.length}`}>
            <Text style={[styles.note, { color: palette.text.secondary }]}>
              Только выбранные сотрудники появятся на странице.
            </Text>
            {resourcesQuery.isLoading ? (
              <Text style={[styles.note, { color: palette.text.secondary }]}>Загружаем сотрудников…</Text>
            ) : resourcesQuery.isError ? (
              <View>
                <Text style={styles.error}>Не удалось загрузить сотрудников.</Text>
                <TouchableOpacity accessibilityRole="button" onPress={() => void resourcesQuery.refetch()}>
                  <Text style={styles.retryText}>Повторить загрузку сотрудников</Text>
                </TouchableOpacity>
              </View>
            ) : resources.length === 0 ? (
              <Text style={[styles.note, { color: palette.text.secondary }]}>Нет сотрудников для выбора мастеров.</Text>
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
          </SettingsSection>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={save.isPending || !!uploadingBranding}
            onPress={submit}
            style={[styles.button, save.isPending && styles.disabled]}
          >
            <Text style={styles.buttonText}>{save.isPending ? 'Сохраняем…' : 'Сохранить страницу'}</Text>
          </TouchableOpacity>
          {settings && (
            <TouchableOpacity
              accessibilityRole="button"
              disabled={publish.isPending || !!uploadingBranding || Object.keys(draft).length > 0}
              onPress={() => publish.mutate(settings.published)}
              style={[
                styles.button,
                styles.secondary,
                (publish.isPending || Object.keys(draft).length > 0) && styles.disabled,
              ]}
            >
              <Text style={[styles.buttonText, styles.secondaryText]}>
                {settings.published ? 'Снять с публикации' : 'Опубликовать страницу'}
              </Text>
            </TouchableOpacity>
          )}
          {publicUrl && (
            <>
              <Text selectable style={[styles.note, { color: palette.text.secondary }]}>
                {publicUrl}
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() => void Share.share({ message: publicUrl })}
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

function SettingsSection({
  title,
  summary,
  children,
  initialOpen = false,
}: {
  title: string;
  summary: string;
  children: ReactNode;
  initialOpen?: boolean;
}) {
  const palette = useColors();
  const [open, setOpen] = useState(initialOpen);
  return (
    <View style={[styles.panel, { backgroundColor: palette.bg.card }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={styles.panelHeading}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.panelTitle, { color: palette.text.primary }]}>{title}</Text>
          <Text style={[styles.note, { color: palette.text.secondary }]}>{summary}</Text>
        </View>
        <Text style={[styles.expand, { color: palette.text.secondary }]}>{open ? 'Скрыть' : 'Изменить'}</Text>
      </TouchableOpacity>
      {open && <View style={styles.panelBody}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  brandingRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 18 },
  brandingPreview: { width: 88, height: 68, borderRadius: 12, backgroundColor: '#fff' },
  brandingLogo: { width: 68, height: 68, borderRadius: 34 },
  brandingControls: { flex: 1 },
  brandingAction: { minHeight: 44, justifyContent: 'center' },
  intro: { paddingVertical: spacing[3], marginBottom: spacing[3] },
  introTitle: { fontSize: 27, fontWeight: '700', letterSpacing: -0.5 },
  link: { fontSize: 14, marginTop: spacing[2] },
  panel: { borderRadius: 16, marginBottom: spacing[3] },
  panelHeading: { minHeight: 78, padding: spacing[4], flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  panelTitle: { fontSize: 16, fontWeight: '600' },
  expand: { fontSize: 12 },
  panelBody: { paddingHorizontal: spacing[4], paddingBottom: spacing[4] },
  safe: { flex: 1 },
  embedded: { flex: 1 },
  loader: { marginTop: 48 },
  content: { padding: spacing[4], paddingBottom: spacing[10] },
  label: { fontSize: 13, fontWeight: '600', marginTop: spacing[3], marginBottom: spacing[1] },
  input: { minHeight: 48, borderWidth: 1, borderRadius: borderRadius.md, paddingHorizontal: spacing[3], fontSize: 16 },
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
  daysTabs: { gap: spacing[2], paddingVertical: spacing[2] },
  dayTab: {
    width: 40,
    height: 46,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  dayTabActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[500] },
  dayTabText: { color: colors.gray[600], fontSize: 12, fontWeight: '600' },
  dayTabTextActive: { color: colors.primary[700] },
  dayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  dayDotOpen: { backgroundColor: colors.green[600] },
  hoursTimeGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  timeInput: { width: 70, height: 38, borderWidth: 1, borderRadius: borderRadius.sm, textAlign: 'center' },
  legalCard: { borderWidth: 1, borderRadius: borderRadius.md, padding: spacing[3], marginTop: spacing[5] },
  legalText: { fontSize: 12, lineHeight: 18, marginBottom: spacing[2] },
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
  retryText: { color: colors.primary[700], textDecorationLine: 'underline', paddingVertical: spacing[2] },
});
