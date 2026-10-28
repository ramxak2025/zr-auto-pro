import React from 'react';
import { Alert, Switch, TextInput, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { registerPushToken } from '../../contexts/AuthContext';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import { AdminPage, AdminGroup, AdminRow, AdminState, AdminAction, adminUIStyles } from './AdminUI';
import { usePlatformSession } from './usePlatformData';
import { assertPlatformSession } from './platformSession';
import { parseReminderDays } from './reminderSettingsValidation';
import type { PlatformReminderSettings } from '../../../../shared/types';
export default function AdminReminderSettingsScreen() {
  const { session } = usePlatformSession();
  return <ReminderSettingsContent key={`${session.data.generation}:${session.authEpoch}`} />;
}
function ReminderSettingsContent() {
  const { session, allowed } = usePlatformSession(),
    p = useColors(),
    client = useQueryClient();
  const [draft, setDraft] = React.useState<PlatformReminderSettings | null>(null);
  const [days, setDays] = React.useState('');
  const [saving, setSaving] = React.useState(false),
    [denied, setDenied] = React.useState(false);
  const [pushBusy, setPushBusy] = React.useState(false);
  const query = useQuery({
    queryKey: ['manager', 'reminder-settings', session.data.key, session.data.generation],
    enabled: allowed,
    queryFn: async () => {
      assertPlatformSession(session, allowed);
      const r = await session.manager.reminderSettings();
      assertPlatformSession(session, allowed);
      return r.data;
    },
  });
  React.useEffect(() => {
    if (query.data && session.isCurrent()) {
      setDraft(query.data);
      setDays(query.data.daysBefore.join(', '));
    }
  }, [query.data, session]);
  React.useEffect(() => {
    void Notifications.getPermissionsAsync()
      .then((status) => {
        if (session.isCurrent()) setDenied(status.status !== 'granted');
      })
      .catch(() => {});
  }, [session]);
  const save = async () => {
    const parsed = parseReminderDays(days);
    if (!draft || !allowed) return;
    if (!parsed || (draft.expiryEnabled && parsed.length === 0)) {
      Alert.alert('Проверьте дни', 'Укажите от 1 до 8 разных значений от 0 до 30. День 0 — дата окончания подписки.');
      return;
    }
    setSaving(true);
    try {
      assertPlatformSession(session, allowed);
      const r = await session.manager.updateReminderSettings({ ...draft, daysBefore: parsed });
      assertPlatformSession(session, allowed);
      setDraft(r.data);
      await client.invalidateQueries({ queryKey: ['manager', 'reminder-settings'] });
      await client.invalidateQueries({ queryKey: ['manager', 'reminders'] });
      if (session.isCurrent()) Alert.alert('Сохранено', 'Настройки напоминаний обновлены.');
    } catch (error) {
      if (session.isCurrent()) Alert.alert('Не удалось сохранить', 'Проверьте соединение и повторите попытку.');
    } finally {
      if (session.isCurrent()) setSaving(false);
    }
  };
  const togglePush = async (value: boolean) => {
    if (!draft || !allowed) return;
    if (!value) {
      setDraft({ ...draft, pushEnabled: false });
      return;
    }
    setPushBusy(true);
    try {
      await registerPushToken();
      if (!session.isCurrent()) return;
      const permissions = await Notifications.getPermissionsAsync();
      if (!session.isCurrent()) return;
      setDenied(permissions.status !== 'granted');
      setDraft((previous) => (previous ? { ...previous, pushEnabled: permissions.status === 'granted' } : null));
    } catch {
      if (session.isCurrent())
        Alert.alert(
          'Не удалось проверить разрешение',
          'Попробуйте ещё раз. Центр напоминаний доступен внутри приложения.',
        );
    } finally {
      if (session.isCurrent()) setPushBusy(false);
    }
  };
  return (
    <AdminPage composition="navigation" title="Настройки напоминаний" back>
      <AdminState
        loading={query.isPending}
        error={query.isError}
        onRetry={() => {
          if (allowed) void query.refetch();
        }}
      />
      {draft && allowed ? (
        <>
          <AdminGroup>
            <AdminRow
              label="Окончание подписок"
              trailing={
                <Switch
                  accessibilityLabel="Напоминать об окончании подписок"
                  value={draft.expiryEnabled}
                  disabled={saving || pushBusy}
                  onValueChange={(value) => setDraft({ ...draft, expiryEnabled: value })}
                  trackColor={{ true: p.accent.primary }}
                />
              }
            />
            <Text variant="footnote" color={p.text.secondary}>
              За сколько дней до окончания: 7, 3, 1 и в день окончания. Можно указать свои значения.
            </Text>
            <TextInput
              accessibilityLabel="Дни до окончания подписки"
              value={days}
              editable={!saving && !pushBusy}
              onChangeText={setDays}
              keyboardType="numbers-and-punctuation"
              style={[adminUIStyles.input, { color: p.text.primary, backgroundColor: p.bg.muted }]}
            />
            <AdminAction
              label="Использовать 7, 3, 1, 0"
              disabled={saving || pushBusy}
              onPress={() => setDays('7, 3, 1, 0')}
            />
          </AdminGroup>
          <AdminGroup>
            <AdminRow
              label="Push-уведомления"
              detail="Необязательно. Напоминания всегда доступны внутри приложения."
              trailing={
                <Switch
                  accessibilityLabel="Push-уведомления о клиентах"
                  value={draft.pushEnabled}
                  disabled={saving || pushBusy}
                  onValueChange={(value) => void togglePush(value)}
                  trackColor={{ true: p.accent.primary }}
                />
              }
            />
            {denied ? (
              <>
                <Text variant="footnote" color={p.text.secondary}>
                  Системное разрешение на уведомления выключено. Центр напоминаний продолжает работать.
                </Text>
                <AdminAction label="Открыть настройки устройства" onPress={() => void Linking.openSettings()} />
              </>
            ) : null}
          </AdminGroup>
          <AdminAction
            label={saving ? 'Сохраняем…' : 'Сохранить'}
            disabled={saving || pushBusy}
            onPress={() => void save()}
          />
        </>
      ) : null}
    </AdminPage>
  );
}
