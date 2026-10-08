import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import type { ProcurementRecovery } from '../hooks/useProcurementRecovery';
import type { PendingProcurement } from '../../../shared/utils/durableProcurement';

const labels = {
  'po-receive': 'Приёмка заказа',
  'delivery-create': 'Новая поставка',
  'delivery-return': 'Возврат поставщику',
};
export function ProcurementRecoveryPanel({
  recovery,
  onRecovered,
}: {
  recovery: ProcurementRecovery;
  onRecovered: (record: PendingProcurement) => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  if (!recovery.pending.length && !recovery.error) return null;
  const resume = async (record: PendingProcurement) => {
    setFailure(null);
    try {
      const result = await recovery.resume(record);
      if (recovery.owns(result)) onRecovered(record);
    } catch (error) {
      if (recovery.owns(error))
        setFailure(error instanceof Error ? error.message : 'Проведение не подтверждено. Повторите восстановление.');
    }
  };
  return (
    <View style={{ padding: 16, gap: 10, backgroundColor: '#fff3d6' }} accessibilityRole="summary">
      <Text style={{ fontWeight: '600', color: '#332a17' }}>Проверка сохранённых операций</Text>
      <Text style={{ color: '#332a17' }}>
        Восстановите исходную отправку после потери ответа. Количество, цены и дата сохранены; второй документ не
        создаётся.
      </Text>
      {!!recovery.error && <Text style={{ color: '#332a17' }}>{recovery.error}</Text>}
      {!!failure && <Text style={{ color: '#332a17' }}>{failure}</Text>}
      {recovery.pending.map((record) => (
        <View key={record.requestId} style={{ gap: 6 }}>
          <Text style={{ color: '#332a17' }}>
            {labels[record.target.operation]} · {new Date(record.createdAt).toLocaleString('ru-RU')}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={recovery.busy}
            onPress={() => void resume(record)}
            style={{ paddingVertical: 10 }}
          >
            <Text style={{ color: '#174ea6', fontWeight: '600' }}>Восстановить результат</Text>
          </Pressable>
        </View>
      ))}
      {!!recovery.error && (
        <Pressable accessibilityRole="button" onPress={() => void recovery.refresh()}>
          <Text style={{ color: '#174ea6' }}>Повторить чтение</Text>
        </Pressable>
      )}
    </View>
  );
}
