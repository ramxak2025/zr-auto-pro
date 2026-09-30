/**
 * PlanPickerSheet — выбор тарифа автосервиса (суперадмин и менеджер). Заменяет Alert.alert со
 * списком тарифов: на Android в нём видны только три кнопки, лишние тарифы пропадали бы, а
 * без «Отмены» диалог не закрывался.
 */
import React from 'react';
import type { Plan } from '../../../../shared/types';
import { formatMoney } from './adminShared';
import { AdminSheet, SheetHint, SheetLabel, SheetOptionRow } from './adminSheet';

interface PlanPickerSheetProps {
  visible: boolean;
  tenantName: string;
  currentPlanId?: string | null;
  plans: Plan[];
  saving?: boolean;
  onClose: () => void;
  onPick: (planId: string) => void;
}

export default function PlanPickerSheet({
  visible,
  tenantName,
  currentPlanId,
  plans,
  saving = false,
  onClose,
  onPick,
}: PlanPickerSheetProps) {
  const options = React.useMemo(
    () => plans.filter((p) => p.isActive && p.id !== currentPlanId),
    [plans, currentPlanId],
  );
  const [selected, setSelected] = React.useState<string | null>(null);

  const wasVisible = React.useRef(false);
  React.useEffect(() => {
    if (visible && !wasVisible.current) setSelected(null);
    wasVisible.current = visible;
  }, [visible]);

  return (
    <AdminSheet
      visible={visible}
      title="Сменить тариф"
      saveLabel="Назначить"
      saving={saving}
      saveDisabled={!selected}
      onClose={onClose}
      onSave={() => {
        if (selected) onPick(selected);
      }}
    >
      <SheetLabel>{`Автосервис «${tenantName}»`}</SheetLabel>
      {options.map((p) => (
        <SheetOptionRow
          key={p.id}
          title={p.name}
          subtitle={`${formatMoney(p.monthlyPrice)}/мес`}
          selected={selected === p.id}
          onPress={() => setSelected(p.id)}
        />
      ))}
      <SheetHint icon="information-circle-outline">
        Цена в карточке и лимит сотрудников перейдут на новый тариф. Срок подписки не меняется.
      </SheetHint>
    </AdminSheet>
  );
}
