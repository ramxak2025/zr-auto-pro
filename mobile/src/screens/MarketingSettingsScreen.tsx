/**
 * MarketingSettingsScreen — «Настройки» маркетинга.
 *
 * One home for every marketing text / config, grouped BY SECTION so the owner
 * never hunts for a message template again. Pulled OUT of the «Интеграции» and
 * «Отзывы» screens (which used to double as settings catch-alls):
 *
 *   • Площадки отзывов        — Google / Яндекс / 2GIS / Авито ссылки
 *                               (getPlatformLinks / upsert / remove)
 *   • Запрос отзыва           — авто-отправка + текст (marketingApi.getSettings /
 *                               updateSettings)
 *   • «Машина готова»          — уведомление о готовности (getCarReadySettings /
 *                               updateCarReadySettings)
 *   • Напоминание о визите    — раз в N месяцев (getReminderSettings /
 *                               updateReminderSettings)
 *   • Рассрочка — платежи      — напоминания о взносе (installmentsApi
 *                               reminder-settings)
 *
 * Each of the four text surfaces maps 1:1 to an entry in the «Рассылки» → «Авто»
 * overview, so «Настроить» there deep-links straight here.
 *
 * Owner-class only (director / admin / superadmin) — configures outbound
 * messaging. The screen self-gates; the hub row is roles-filtered too.
 */
import React, { useRef, useState } from 'react';
import { View, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { marketingApi, installmentsApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import IosScreenHeader from '../components/IosScreenHeader';
import SectionHeader from '../components/SectionHeader';
import { BottomSheet } from '../components/BottomSheet';
import EmptyState from '../components/EmptyState';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { UserRole } from '../../../shared/types';
import type { ReviewPlatformLink, ReviewSettings } from '../../../shared/types';

// ─────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_CAR_READY_TEMPLATE =
  'Здравствуйте, {clientName}! Ваш автомобиль {car} готов к выдаче. Заказ-наряд №{number}. Спасибо, что выбрали нас!';

type PlatformKey = ReviewPlatformLink['platform'];

interface PlatformDef {
  key: PlatformKey;
  name: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: { bg: string; fg: string };
  placeholder: string;
}

const PLATFORMS: PlatformDef[] = [
  {
    key: 'google',
    name: 'Google Business',
    description: 'Профиль в Google Maps',
    icon: 'logo-google',
    tone: { bg: '#dbeafe', fg: '#1d4ed8' },
    placeholder: 'https://maps.google.com/...',
  },
  {
    key: 'yandex',
    name: 'Яндекс Бизнес',
    description: 'Карточка в Яндекс Картах',
    icon: 'globe-outline',
    tone: { bg: '#fee2e2', fg: '#b91c1c' },
    placeholder: 'https://yandex.ru/maps/org/...',
  },
  {
    key: '2gis',
    name: '2GIS',
    description: 'Профиль в справочнике 2GIS',
    icon: 'map-outline',
    tone: { bg: '#dcfce7', fg: '#16a34a' },
    placeholder: 'https://2gis.ru/...',
  },
  {
    key: 'avito',
    name: 'Авито',
    description: 'Профиль автосервиса на Авито',
    icon: 'storefront-outline',
    tone: { bg: '#dbeafe', fg: '#2563eb' },
    placeholder: 'https://www.avito.ru/...',
  },
];

// ─────────────────────────────────────────────────────────────────────
//  Shared primitives
// ─────────────────────────────────────────────────────────────────────

function Switch({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  const palette = useColors();
  return (
    <TouchableOpacity
      onPress={() => {
        haptic('select');
        onToggle();
      }}
      activeOpacity={0.8}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={[styles.switchTrack, { backgroundColor: value ? palette.accent.primary : palette.border.strong }]}>
        <View style={[styles.switchThumb, { transform: [{ translateX: value ? 20 : 2 }] }]} />
      </View>
    </TouchableOpacity>
  );
}

function SaveButton({ onPress, pending, disabled }: { onPress: () => void; pending: boolean; disabled?: boolean }) {
  const palette = useColors();
  return (
    <TouchableOpacity
      style={[styles.saveBtn, { backgroundColor: palette.accent.primary }, (pending || disabled) && { opacity: 0.55 }]}
      onPress={onPress}
      disabled={pending || disabled}
      activeOpacity={0.85}
    >
      {pending ? (
        <ActivityIndicator size="small" color={colors.white} />
      ) : (
        <>
          <Ionicons name="checkmark" size={16} color={colors.white} />
          <Text style={styles.saveBtnText}>Сохранить</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function ToggleRow({
  title,
  subtitle,
  value,
  onToggle,
}: {
  title: string;
  subtitle: string;
  value: boolean;
  onToggle: () => void;
}) {
  const palette = useColors();
  return (
    <View style={[styles.toggleRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.toggleTitle, { color: palette.text.primary }]}>{title}</Text>
        <Text style={[styles.toggleSub, { color: palette.text.tertiary }]}>{subtitle}</Text>
      </View>
      <Switch value={value} onToggle={onToggle} />
    </View>
  );
}

function TemplateInput({
  value,
  onChangeText,
  placeholder,
  hint,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  hint?: string;
}) {
  const palette = useColors();
  return (
    <View style={{ marginTop: spacing[3] }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        style={[
          styles.textArea,
          { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
        ]}
        multiline
        textAlignVertical="top"
        placeholder={placeholder}
        placeholderTextColor={palette.text.tertiary}
      />
      {hint ? <Text style={[styles.hint, { color: palette.text.tertiary }]}>{hint}</Text> : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Section: Площадки отзывов
// ─────────────────────────────────────────────────────────────────────

function PlatformLinksSection() {
  const palette = useColors();
  const [editing, setEditing] = useState<PlatformDef | null>(null);

  const linksQuery = useQuery({
    queryKey: ['marketing-platform-links'],
    queryFn: async () => (await marketingApi.getPlatformLinks()).data,
    staleTime: 60_000,
  });
  const links: ReviewPlatformLink[] = Array.isArray(linksQuery.data) ? linksQuery.data : [];
  const findLink = (key: PlatformKey) => links.find((l) => l.platform === key);

  return (
    <View>
      <SectionHeader title="Площадки отзывов" count={null} />
      <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <Text style={[styles.cardLead, { color: palette.text.secondary }]}>
          Ссылки на профили, куда отправляем клиентов оставить отзыв.
        </Text>
        {PLATFORMS.map((p, idx) => {
          const link = findLink(p.key);
          const connected = !!link?.url;
          return (
            <TouchableOpacity
              key={p.key}
              style={[
                styles.platformRow,
                idx > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border.subtle },
              ]}
              onPress={() => {
                haptic('tap');
                setEditing(p);
              }}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.platformIcon,
                  { backgroundColor: palette.mode === 'dark' ? softTint(p.tone.fg, 'dark') : p.tone.bg },
                ]}
              >
                <Ionicons name={p.icon} size={18} color={p.tone.fg} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.platformName, { color: palette.text.primary }]} numberOfLines={1}>
                  {p.name}
                </Text>
                <Text
                  style={[styles.platformUrl, { color: connected ? palette.text.tertiary : palette.text.tertiary }]}
                  numberOfLines={1}
                >
                  {connected ? link!.url : 'Не подключено'}
                </Text>
              </View>
              {connected ? (
                <View
                  style={[styles.dot, { backgroundColor: link!.isActive ? colors.green[500] : palette.text.tertiary }]}
                />
              ) : null}
              <Ionicons name="chevron-forward" size={17} color={palette.text.tertiary} />
            </TouchableOpacity>
          );
        })}
      </View>

      <PlatformSheet
        platform={editing}
        existing={editing ? findLink(editing.key) : undefined}
        onClose={() => setEditing(null)}
      />
    </View>
  );
}

function PlatformSheet({
  platform,
  existing,
  onClose,
}: {
  platform: PlatformDef | null;
  existing?: ReviewPlatformLink;
  onClose: () => void;
}) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [isActive, setIsActive] = useState(true);

  React.useEffect(() => {
    if (platform) {
      setUrl(existing?.url ?? '');
      setIsActive(existing?.isActive ?? true);
    }
  }, [platform, existing]);

  const save = useMutation({
    mutationFn: () => marketingApi.upsertPlatformLink({ platform: platform!.key, url: url.trim(), isActive }),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['marketing-platform-links'] });
      onClose();
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  const remove = useMutation({
    mutationFn: () => marketingApi.removePlatformLink(existing!.id),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['marketing-platform-links'] });
      onClose();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось удалить');
    },
  });

  return (
    <BottomSheet visible={!!platform} onClose={onClose} title={platform?.name ?? ''} heightRatio={0.55}>
      {platform ? (
        <View style={{ gap: spacing[3] }}>
          <View>
            <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Ссылка на профиль</Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              style={[
                styles.input,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              placeholder={platform.placeholder}
              placeholderTextColor={palette.text.tertiary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
          </View>

          <ToggleRow
            title="Показывать клиентам"
            subtitle="Клиенты с оценкой 5 увидят кнопку этой площадки"
            value={isActive}
            onToggle={() => setIsActive((v) => !v)}
          />

          <SaveButton onPress={() => save.mutate()} pending={save.isPending} disabled={!url.trim()} />

          {existing ? (
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => {
                haptic('warning');
                Alert.alert('Удалить ссылку?', platform.name, [
                  { text: 'Отмена', style: 'cancel' },
                  { text: 'Удалить', style: 'destructive', onPress: () => remove.mutate() },
                ]);
              }}
              disabled={remove.isPending}
            >
              <Text style={[styles.removeBtnText, { color: colors.red[600] }]}>Удалить ссылку</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </BottomSheet>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Section: Запрос отзыва (review request text)
// ─────────────────────────────────────────────────────────────────────

function ReviewTextSection() {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [autoSend, setAutoSend] = useState(false);
  const [template, setTemplate] = useState('');
  const hydrated = useRef(false);

  const settingsQuery = useQuery({
    queryKey: ['marketing-settings'],
    queryFn: async () => (await marketingApi.getSettings()).data,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (settingsQuery.data && !hydrated.current) {
      hydrated.current = true;
      setAutoSend(!!settingsQuery.data.autoSendEnabled);
      setTemplate(settingsQuery.data.messageTemplate || '');
    }
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      marketingApi.updateSettings({
        autoSendEnabled: autoSend,
        messageTemplate: template.trim(),
      } as Partial<ReviewSettings>),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['marketing-settings'] });
      Alert.alert('Готово', 'Текст запроса отзыва сохранён');
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  return (
    <View>
      <SectionHeader title="Запрос отзыва" count={null} />
      <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <ToggleRow
          title="Отправлять автоматически"
          subtitle="После закрытия заказ-наряда клиент получит ссылку на отзыв"
          value={autoSend}
          onToggle={() => setAutoSend((v) => !v)}
        />
        <TemplateInput
          value={template}
          onChangeText={setTemplate}
          placeholder="Здравствуйте, {имя}! Оцените, пожалуйста, наш сервис по ссылке ниже."
          hint="Ссылка на форму отзыва добавляется автоматически. {motivation} — подставит «подарок за отзыв»."
        />
        <SaveButton onPress={() => save.mutate()} pending={save.isPending} disabled={settingsQuery.isLoading} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Section: «Машина готова»
// ─────────────────────────────────────────────────────────────────────

function CarReadySection() {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [template, setTemplate] = useState(DEFAULT_CAR_READY_TEMPLATE);
  const hydrated = useRef(false);

  const settingsQuery = useQuery({
    queryKey: ['marketing-car-ready'],
    queryFn: async () => (await marketingApi.getCarReadySettings()).data,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (settingsQuery.data && !hydrated.current) {
      hydrated.current = true;
      setEnabled(!!settingsQuery.data.enabled);
      setTemplate(settingsQuery.data.messageTemplate || DEFAULT_CAR_READY_TEMPLATE);
    }
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      marketingApi.updateCarReadySettings({ enabled, messageTemplate: template.trim() || DEFAULT_CAR_READY_TEMPLATE }),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['marketing-car-ready'] });
      Alert.alert('Готово', 'Уведомление сохранено');
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  const handleSave = () => {
    if (enabled && !template.trim()) {
      Alert.alert('Ошибка', 'Введите текст уведомления');
      return;
    }
    save.mutate();
  };

  return (
    <View>
      <SectionHeader title="Уведомление «Машина готова»" count={null} />
      <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <ToggleRow
          title="Уведомлять клиента"
          subtitle="Сообщение уйдёт, когда машина переходит в статус «Готова»"
          value={enabled}
          onToggle={() => setEnabled((v) => !v)}
        />
        <TemplateInput
          value={template}
          onChangeText={setTemplate}
          placeholder={DEFAULT_CAR_READY_TEMPLATE}
          hint="{number} — номер заказа · {car} — авто · {clientName} — имя клиента"
        />
        <SaveButton onPress={handleSave} pending={save.isPending} disabled={settingsQuery.isLoading} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Section: Напоминание о визите
// ─────────────────────────────────────────────────────────────────────

function VisitReminderSection() {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [monthsInterval, setMonthsInterval] = useState(6);
  const [template, setTemplate] = useState('');
  const hydrated = useRef(false);

  const settingsQuery = useQuery({
    queryKey: ['reminder-settings'],
    queryFn: async () => (await marketingApi.getReminderSettings()).data,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (settingsQuery.data && !hydrated.current) {
      hydrated.current = true;
      setEnabled(!!settingsQuery.data.enabled);
      setMonthsInterval(settingsQuery.data.monthsInterval || 6);
      setTemplate(settingsQuery.data.messageTemplate || '');
    }
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      marketingApi.updateReminderSettings({ enabled, monthsInterval, messageTemplate: template.trim() }),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['reminder-settings'] });
      Alert.alert('Готово', 'Напоминание сохранено');
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  return (
    <View>
      <SectionHeader title="Напоминание о визите" count={null} />
      <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <ToggleRow
          title="Напоминать о плановом визите"
          subtitle={enabled ? 'Пишем клиентам раз в выбранный период' : 'Отключено — никому не пишем'}
          value={enabled}
          onToggle={() => setEnabled((v) => !v)}
        />

        <Text style={[styles.fieldLabel, { color: palette.text.secondary, marginTop: spacing[3] }]}>Раз в</Text>
        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
          {[3, 6, 12].map((m) => {
            const active = monthsInterval === m;
            return (
              <TouchableOpacity
                key={m}
                style={[
                  styles.intervalChip,
                  {
                    backgroundColor: active ? palette.accent.primary : palette.bg.muted,
                    borderColor: active ? palette.accent.primary : palette.border.subtle,
                  },
                ]}
                onPress={() => {
                  haptic('select');
                  setMonthsInterval(m);
                }}
              >
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    fontWeight: fontWeight.bold,
                    color: active ? colors.white : palette.text.secondary,
                  }}
                >
                  {m}
                </Text>
                <Text style={{ fontSize: 11, color: active ? colors.white : palette.text.tertiary }}>
                  {m === 3 ? 'месяца' : 'месяцев'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <TemplateInput
          value={template}
          onChangeText={setTemplate}
          placeholder="Здравствуйте, {имя}! Прошло {месяцы} месяцев с вашего последнего визита. Ждём вас!"
          hint="{имя} · {авто} · {месяцы}"
        />
        <SaveButton onPress={() => save.mutate()} pending={save.isPending} disabled={settingsQuery.isLoading} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Section: Рассрочка — напоминания о платеже
// ─────────────────────────────────────────────────────────────────────

const INSTALLMENT_MODES: { key: 'off' | 'auto' | 'manual'; label: string }[] = [
  { key: 'off', label: 'Выкл' },
  { key: 'auto', label: 'Авто' },
  { key: 'manual', label: 'Вручную' },
];

function InstallmentReminderSection() {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'off' | 'auto' | 'manual'>('off');
  const [template, setTemplate] = useState('');
  const hydrated = useRef(false);

  const settingsQuery = useQuery({
    queryKey: ['installment-reminder-settings'],
    queryFn: async () => (await installmentsApi.getReminderSettings()).data,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (settingsQuery.data && !hydrated.current) {
      hydrated.current = true;
      setMode(settingsQuery.data.mode || 'off');
      setTemplate(settingsQuery.data.template || '');
    }
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: () => installmentsApi.updateReminderSettings({ mode, template: template.trim() }),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['installment-reminder-settings'] });
      Alert.alert('Готово', 'Напоминание о платеже сохранено');
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  return (
    <View>
      <SectionHeader title="Рассрочка — напоминания о платеже" count={null} />
      <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <Text style={[styles.cardLead, { color: palette.text.secondary }]}>
          Клиентам с рассрочкой — напоминание о предстоящем взносе.
        </Text>
        <View style={[styles.segment, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          {INSTALLMENT_MODES.map((m) => {
            const active = mode === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[styles.segmentItem, active && { backgroundColor: palette.bg.card }]}
                onPress={() => {
                  haptic('select');
                  setMode(m.key);
                }}
                activeOpacity={0.8}
              >
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    fontWeight: active ? fontWeight.bold : fontWeight.medium,
                    color: active ? palette.text.primary : palette.text.tertiary,
                  }}
                >
                  {m.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TemplateInput
          value={template}
          onChangeText={setTemplate}
          placeholder="Здравствуйте, {имя}! Напоминаем о платеже по рассрочке. Спасибо!"
          hint="Отправляется активным каналом рассылок за несколько дней до платежа."
        />
        <SaveButton onPress={() => save.mutate()} pending={save.isPending} disabled={settingsQuery.isLoading} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────

export default function MarketingSettingsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();

  const isOwner = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  if (!isOwner) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Настройки" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="lock"
          title="Доступ ограничен"
          description="Настройки маркетинга доступны владельцу и администраторам."
        />
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Настройки маркетинга" onBack={() => navigation.goBack()} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: palette.text.secondary }]}>
          Ссылки на площадки и тексты сообщений, которые уходят клиентам автоматически.
        </Text>
        <View style={{ gap: spacing[5] }}>
          <PlatformLinksSection />
          <ReviewTextSection />
          <CarReadySection />
          <VisitReminderSection />
          <InstallmentReminderSection />
        </View>
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4] },
  intro: { fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing[4] },

  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
    marginTop: spacing[2],
  },
  cardLead: { fontSize: fontSize.xs, lineHeight: 17, marginBottom: spacing[3] },

  // Platform rows
  platformRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  platformIcon: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  platformUrl: { fontSize: fontSize.xs, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },

  // Toggle row
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing[3],
  },
  toggleTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  toggleSub: { fontSize: 11, marginTop: 2, lineHeight: 15 },

  // iOS switch
  switchTrack: { width: 44, height: 26, borderRadius: 13, justifyContent: 'center' },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },

  // Interval chips
  intervalChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },

  // Segmented control
  segment: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
  },

  // Text area / inputs
  textArea: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    fontSize: fontSize.sm,
    minHeight: 96,
  },
  hint: { fontSize: 11, marginTop: spacing[1.5], lineHeight: 15 },
  fieldLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: fontSize.sm,
    marginTop: spacing[1.5],
  },

  // Save button
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    marginTop: spacing[4],
  },
  saveBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  removeBtn: { alignItems: 'center', paddingVertical: spacing[2] },
  removeBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
