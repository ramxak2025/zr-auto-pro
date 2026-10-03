import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { createSessionBoundClient } from '../api/axios';
import { createOneCApi, type OneCEntityType } from '../../../shared/api/oneC';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import { Text } from '../platform/Typography';
import { Button } from './Button';
import Modal from './Modal';

const labels: Record<OneCEntityType, string> = {
  products: 'Номенклатура',
  stock: 'Остатки',
  clients: 'Клиенты',
  purchases: 'Закупки',
  workOrders: 'Заказ-наряды',
  payments: 'Оплаты',
};
const statuses: Record<string, string> = {
  applied: 'Применено',
  needs_review: 'Нужна сверка',
  rejected: 'Отклонено',
  exported: 'Передано',
  processing: 'Обрабатывается',
};

export default function OneCIntegrationCard() {
  const { user, token } = useAuth();
  const palette = useColors();
  const [open, setOpen] = useState(false);
  if (!user || !['director', 'superadmin'].includes(user.role)) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Обмен с 1С, открыть настройки"
        onPress={() => setOpen(true)}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <Text style={[styles.title, { color: palette.text.primary }]}>1С · Обмен данными</Text>
        <Text style={{ color: palette.text.secondary }}>Номенклатура, остатки, клиенты и документы</Text>
        <Text style={{ color: palette.accent.primaryText }}>Пилотное подключение · Настроить</Text>
      </Pressable>
      {open && (
        <ConnectionSettings
          key={`${user.tenantId}:${user.id}:${token}`}
          token={token}
          identity={`${user.tenantId}:${user.id}`}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ConnectionSettings({
  identity,
  token,
  onClose,
}: {
  identity: string;
  token: string | null;
  onClose: () => void;
}) {
  const exchange = useMemo(() => createOneCApi(createSessionBoundClient(token)), [token]);
  const palette = useColors();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [pointId, setPointId] = useState('');
  const [showJournal, setShowJournal] = useState(false);
  const [offset, setOffset] = useState(0);
  const settings = useQuery({
    queryKey: ['one-c', identity],
    queryFn: async () => (await exchange.getConnection()).data,
  });
  const journal = useQuery({
    queryKey: ['one-c-journal', identity, offset],
    queryFn: async () => (await exchange.journal({ limit: 10, offset })).data,
    enabled: showJournal && !!settings.data?.connection,
  });
  const connection = settings.data?.connection;
  const points = settings.data?.availablePoints ?? [];
  const selectedPoint = pointId || points[0]?.id || '';
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      if (alive.current) {
        await settings.refetch();
        if (showJournal) await journal.refetch();
      }
    } catch (e) {
      if (alive.current) setError(apiErrorMessage(e) ?? 'Не удалось обновить обмен с 1С');
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const muted = { color: palette.text.secondary };
  return (
    <Modal visible title="Обмен с 1С" onClose={onClose}>
      <View style={styles.content}>
        <Text style={muted}>
          1С:Управление нашей фирмой 3 · пилотное подключение. Специалист 1С должен настроить обмен и сверить данные на
          копии базы перед включением.
        </Text>
        {settings.isLoading && <ActivityIndicator accessibilityLabel="Загрузка подключения" />}
        {settings.isError && (
          <Button title="Повторить загрузку настроек" variant="secondary" onPress={() => void settings.refetch()} />
        )}
        {!!error && (
          <Text accessibilityRole="alert" style={muted}>
            {error}
          </Text>
        )}
        {settings.data && !connection && (
          <>
            <Text style={[styles.subtitle, { color: palette.text.primary }]}>Филиал для обмена</Text>
            {points.map((p) => (
              <Pressable
                key={p.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedPoint === p.id }}
                onPress={() => setPointId(p.id)}
                style={[
                  styles.point,
                  { borderColor: selectedPoint === p.id ? palette.accent.primary : palette.border.subtle },
                ]}
              >
                <Text style={{ color: palette.text.primary }}>
                  {selectedPoint === p.id ? '✓ ' : ''}
                  {p.name}
                </Text>
              </Pressable>
            ))}
            <Button
              title="Подготовить подключение"
              disabled={!selectedPoint}
              loading={busy}
              onPress={() =>
                void perform(async () => {
                  const result = await exchange.create({ pointId: selectedPoint });
                  if (alive.current) setSecret(result.data.apiKey);
                })
              }
            />
          </>
        )}
        {connection && (
          <>
            <Text style={[styles.subtitle, { color: palette.text.primary }]}>
              {connection.status === 'active' ? 'Обмен включён' : 'Обмен приостановлен'}
            </Text>
            <Text style={muted}>{points.find((p) => p.id === connection.pointId)?.name ?? 'Выбранный филиал'}</Text>
            <Text style={muted}>
              {connection.lastSeenAt
                ? `Последнее соединение: ${new Date(connection.lastSeenAt).toLocaleString('ru-RU')}`
                : '1С ещё не подключалась'}
            </Text>
            <Text selectable style={muted}>
              Код подключения: {connection.id}
            </Text>
            {(Object.keys(labels) as OneCEntityType[]).map((kind) => (
              <View key={kind} style={[styles.entity, { borderColor: palette.border.subtle }]}>
                <Text style={[styles.subtitle, { color: palette.text.primary }]}>{labels[kind]}</Text>
                {(['export', 'import'] as const).map((direction) => (
                  <View key={direction} style={styles.row}>
                    <Text style={[muted, styles.flex]}>{direction === 'export' ? 'В 1С' : 'Из 1С'}</Text>
                    <Switch
                      accessibilityLabel={`${labels[kind]} ${direction === 'export' ? 'в 1С' : 'из 1С'}`}
                      value={connection.capabilities[kind][direction]}
                      disabled={busy || (direction === 'import' && !connection.mappingConfirmed)}
                      onValueChange={(checked) =>
                        void perform(() =>
                          exchange.configure({
                            capabilities: {
                              ...connection.capabilities,
                              [kind]: { ...connection.capabilities[kind], [direction]: checked },
                            },
                          }),
                        )
                      }
                    />
                  </View>
                ))}
              </View>
            ))}
            <View style={styles.row}>
              <Text style={[muted, styles.flex]}>
                Соответствие справочников и документов проверено специалистом на копии базы 1С
              </Text>
              <Switch
                accessibilityLabel="Соответствие данных проверено"
                value={connection.mappingConfirmed}
                disabled={busy || connection.status === 'active'}
                onValueChange={(checked) => void perform(() => exchange.configure({ mappingConfirmed: checked }))}
              />
            </View>
            <Button
              title={connection.status === 'active' ? 'Приостановить обмен' : 'Включить обмен'}
              loading={busy}
              disabled={connection.status !== 'active' && !connection.mappingConfirmed}
              onPress={() =>
                void perform(() => exchange.configure({ status: connection.status === 'active' ? 'paused' : 'active' }))
              }
            />
            <Button
              title="Заменить ключ"
              variant="secondary"
              disabled={busy}
              onPress={() =>
                Alert.alert(
                  'Заменить ключ 1С?',
                  'Старый ключ перестанет работать. Новый нужно сохранить в коннекторе 1С.',
                  [
                    { text: 'Отмена', style: 'cancel' },
                    {
                      text: 'Заменить',
                      onPress: () =>
                        void perform(async () => {
                          const result = await exchange.rotateKey();
                          if (alive.current) setSecret(result.data.apiKey);
                        }),
                    },
                  ],
                )
              }
            />
            <Button
              title={showJournal ? 'Скрыть журнал' : 'Журнал обмена'}
              variant="ghost"
              onPress={() => setShowJournal(!showJournal)}
            />
            {showJournal && (
              <View style={styles.content}>
                <Button
                  title="Обновить журнал"
                  size="sm"
                  variant="secondary"
                  loading={journal.isFetching}
                  onPress={() => void journal.refetch()}
                />
                {journal.isError && (
                  <Text accessibilityRole="alert">Не удалось загрузить журнал. Повторите обновление.</Text>
                )}
                {journal.data?.items.length === 0 && <Text style={muted}>Событий обмена пока нет.</Text>}
                {journal.data?.items.map((item) => (
                  <View key={item.id} style={[styles.entity, { borderColor: palette.border.subtle }]}>
                    <Text style={[styles.subtitle, { color: palette.text.primary }]}>
                      {labels[item.entityType]} · {statuses[item.status] ?? item.status}
                    </Text>
                    <Text style={muted}>{item.message}</Text>
                    <Text style={muted}>
                      {new Date(item.createdAt).toLocaleString('ru-RU')} ·{' '}
                      {item.direction === 'import' ? 'Из 1С' : 'В 1С'}
                    </Text>
                  </View>
                ))}
                <View style={styles.row}>
                  <Button
                    title="Назад"
                    size="sm"
                    fullWidth={false}
                    variant="ghost"
                    disabled={offset === 0}
                    onPress={() => setOffset(Math.max(0, offset - 10))}
                  />
                  <Button
                    title="Далее"
                    size="sm"
                    fullWidth={false}
                    variant="ghost"
                    disabled={!journal.data || offset + 10 >= journal.data.total}
                    onPress={() => setOffset(offset + 10)}
                  />
                </View>
              </View>
            )}
          </>
        )}
        {!!secret && (
          <View style={[styles.entity, { borderColor: palette.border.subtle }]}>
            <Text style={muted}>
              Ключ показывается один раз. Сохраните его в коннекторе 1С. Чтобы скопировать, нажмите «Показать» и
              выделите текст.
            </Text>
            <TextInput
              value={secret}
              readOnly
              secureTextEntry={!reveal}
              multiline={reveal}
              autoCorrect={false}
              autoCapitalize="none"
              textContentType="none"
              accessibilityLabel="Ключ подключения 1С"
              style={[styles.secret, { color: palette.text.primary, borderColor: palette.border.subtle }]}
            />
            <Button
              title={reveal ? 'Скрыть ключ' : 'Показать ключ'}
              variant="ghost"
              onPress={() => setReveal(!reveal)}
            />
            <Button
              title="Ключ сохранён"
              variant="secondary"
              onPress={() => {
                setSecret('');
                setReveal(false);
              }}
            />
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 8, marginBottom: 16 },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '700' },
  subtitle: { fontSize: 16, lineHeight: 24, fontWeight: '600' },
  content: { gap: 14 },
  point: { padding: 12, borderWidth: 1, borderRadius: 12 },
  entity: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  flex: { flex: 1 },
  secret: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 48 },
});
