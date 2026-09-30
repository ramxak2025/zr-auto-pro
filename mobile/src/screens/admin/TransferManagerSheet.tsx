/**
 * TransferManagerSheet — «Передать» автосервис другому менеджеру или снять с менеджера
 * (только суперадмин). История платежей остаётся за тем, кто их провёл (долг уже на нём),
 * будущие оплаты пойдут новому менеджеру — это и пишем в подсказке.
 */
import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminManagersApi } from '../../api/services';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { spacing } from '../../theme';
import { extractApiErrorMessage } from '../../utils/apiError';
import { formatPhone } from '../../../../shared/validation/phone';
import type { PlatformManager } from '../../../../shared/types';
import type { TransferTenantManagerResponse } from '../../../../shared/api/types';
import { invalidatePlatformQueries, pluralRu } from './adminShared';
import { AdminSheet, SheetHint, SheetLabel, SheetOptionRow } from './adminSheet';

export interface TransferTarget {
  id: string;
  name: string;
  managerId?: string | null;
  managerName?: string | null;
}

interface TransferManagerSheetProps {
  visible: boolean;
  tenant: TransferTarget | null;
  onClose: () => void;
  onDone?: (result: TransferTenantManagerResponse) => void;
}

/** Слово «клиент» с числом: 1 клиент, 2 клиента, 5 клиентов. */
const clientsLabel = (n: number): string => `${n} ${pluralRu(n, 'клиент', 'клиента', 'клиентов')}`;

export default function TransferManagerSheet({ visible, tenant, onClose, onDone }: TransferManagerSheetProps) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const currentId = tenant?.managerId ?? null;
  const [selected, setSelected] = React.useState<string | null>(currentId);

  const wasVisible = React.useRef(false);
  React.useEffect(() => {
    if (visible && !wasVisible.current) setSelected(currentId);
    wasVisible.current = visible;
  }, [visible, currentId]);

  const {
    data: managers,
    isLoading,
    isError,
    refetch,
  } = useQuery<PlatformManager[]>({
    queryKey: ['admin-managers', 'list'],
    queryFn: async () => (await adminManagersApi.list()).data,
    enabled: visible,
    placeholderData: (prev) => prev,
  });

  // Передать можно только активному менеджеру — сервер иначе вернёт ошибку.
  const options = React.useMemo(
    () => (managers ?? []).filter((m) => m.isActive).sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru')),
    [managers],
  );

  const mutation = useMutation({
    mutationFn: async () => (await adminManagersApi.transferTenant(tenant!.id, { managerId: selected })).data,
    onSuccess: (result) => {
      haptic('success');
      invalidatePlatformQueries(queryClient, tenant?.id);
      onClose();
      onDone?.(result);
    },
    onError: (err) => {
      haptic('error');
      Alert.alert('Не удалось передать', extractApiErrorMessage(err, 'Попробуйте ещё раз'));
    },
  });

  if (!tenant) return null;

  return (
    <AdminSheet
      visible={visible}
      title="Передать клиента"
      saveLabel="Передать"
      saving={mutation.isPending}
      saveDisabled={selected === currentId}
      onClose={onClose}
      onSave={() => mutation.mutate()}
    >
      <SheetLabel>{`Автосервис «${tenant.name}»`}</SheetLabel>
      <SheetOptionRow
        title="Без менеджера"
        subtitle="Клиент владельца платформы"
        selected={selected === null}
        onPress={() => setSelected(null)}
      />
      {isLoading && !managers ? (
        <View style={styles.state}>
          <ActivityIndicator color={palette.accent.primary} />
        </View>
      ) : null}
      {isError && !managers ? (
        <View style={styles.state}>
          <Text style={[styles.stateText, { color: palette.text.secondary }]}>Не удалось загрузить менеджеров</Text>
          <Pressable onPress={() => void refetch()} hitSlop={8}>
            <Text style={[styles.retry, { color: palette.accent.primary }]}>Повторить</Text>
          </Pressable>
        </View>
      ) : null}
      {options.map((m) => (
        <SheetOptionRow
          key={m.id}
          title={m.fullName}
          subtitle={`${formatPhone(m.phone)} · ${clientsLabel(m.tenantsCount)}`}
          selected={selected === m.id}
          onPress={() => setSelected(m.id)}
        />
      ))}
      <SheetHint icon="information-circle-outline">
        История платежей и долг остаются за менеджером, который их провёл. Новые оплаты пойдут новому менеджеру.
      </SheetHint>
    </AdminSheet>
  );
}

const styles = StyleSheet.create({
  state: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[4] },
  stateText: { fontSize: 14 },
  retry: { fontSize: 14, fontWeight: '600' },
});
