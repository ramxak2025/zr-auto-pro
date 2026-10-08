import { useState } from 'react';
import { Button, Card } from '../ui';
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
    <Card className="space-y-3 p-4" role="status">
      <p className="font-medium">Проверка сохранённых операций</p>
      <p className="text-sm">
        После потери ответа восстановите исходную отправку. Количество, цены и дата сохранены; повтор не создаёт второй
        документ.
      </p>
      {recovery.error && <p className="text-sm">{recovery.error}</p>}
      {failure && <p className="text-sm">{failure}</p>}
      {recovery.pending.map((record) => (
        <div key={record.requestId} className="flex items-center justify-between gap-3">
          <span>
            {labels[record.target.operation]} · {new Date(record.createdAt).toLocaleString('ru-RU')}
          </span>
          <Button variant="secondary" disabled={recovery.busy} onClick={() => void resume(record)}>
            Восстановить результат
          </Button>
        </div>
      ))}
      {recovery.error && (
        <Button variant="secondary" onClick={() => void recovery.refresh()}>
          Повторить чтение
        </Button>
      )}
    </Card>
  );
}
