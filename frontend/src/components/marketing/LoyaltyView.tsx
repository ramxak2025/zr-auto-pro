import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Info } from 'lucide-react';
import toast from 'react-hot-toast';

import { loyaltyApi } from '../../api/services';
import type { LoyaltySettings } from '../../types';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { InfoNote, LoadingBlock, SaveButton, SectionCard, SectionError, Toggle } from './marketingKit';

export default function LoyaltyView() {
  const qc = useQueryClient();
  const {
    data: settings,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ['loyalty', 'settings'],
    queryFn: () => loyaltyApi.getSettings().then((r) => r.data),
  });
  const [form, setForm] = useState<Partial<LoyaltySettings>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (settings) {
      setForm(settings);
      setDirty(false);
    }
  }, [settings]);
  const set = (patch: Partial<LoyaltySettings>) => {
    setForm((p) => ({ ...p, ...patch }));
    setDirty(true);
  };
  const clampPct = (v: number) => Math.max(0, Math.min(100, v));

  const save = useMutation({
    mutationFn: (data: Partial<LoyaltySettings>) => loyaltyApi.updateSettings(data).then((r) => r.data),
    onSuccess: (fresh) => {
      qc.setQueryData(['loyalty', 'settings'], fresh);
      setDirty(false);
      toast.success('Сохранено');
    },
    onError: () => toast.error('Ошибка сохранения'),
  });

  return (
    <div className="max-w-3xl space-y-5">
      <SectionCard
        icon={Gift}
        iconTone="accent"
        title="Программа лояльности"
        subtitle="Бонусы клиентам за заказы — начисление и списание при оплате"
        right={
          settings ? (
            <Toggle checked={!!form.enabled} onChange={(v) => set({ enabled: v })} label="Программа лояльности" />
          ) : undefined
        }
      >
        {isLoading ? (
          <LoadingBlock lines={2} />
        ) : isError || !settings ? (
          <SectionError
            message="Не удалось загрузить настройки лояльности"
            onRetry={() => refetch()}
            loading={isFetching}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field
                label="Начисление, % от чека"
                htmlFor="loyalty-accrual"
                hint="Сколько бонусов начисляется с каждого заказа"
              >
                <Input
                  id="loyalty-accrual"
                  inputMode="numeric"
                  value={form.accrualPercent ?? 0}
                  onChange={(e) => set({ accrualPercent: clampPct(parseInt(e.target.value) || 0) })}
                  rightSlot={<span className="text-sm text-ink-3">%</span>}
                />
              </Field>
              <Field
                label="Оплата бонусами, до %"
                htmlFor="loyalty-redeem"
                hint="Какую часть чека можно закрыть бонусами"
              >
                <Input
                  id="loyalty-redeem"
                  inputMode="numeric"
                  value={form.redeemMaxPercent ?? 0}
                  onChange={(e) => set({ redeemMaxPercent: clampPct(parseInt(e.target.value) || 0) })}
                  rightSlot={<span className="text-sm text-ink-3">%</span>}
                />
              </Field>
            </div>

            {!form.enabled && (
              <InfoNote icon={Info}>
                Программа выключена: новые бонусы не начисляются, но накопленные клиентами бонусы остаются и их можно
                списать.
              </InfoNote>
            )}

            {dirty && (
              <SaveButton
                onClick={() =>
                  save.mutate({
                    enabled: form.enabled,
                    accrualPercent: form.accrualPercent,
                    redeemMaxPercent: form.redeemMaxPercent,
                  })
                }
                saving={save.isPending}
              />
            )}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
