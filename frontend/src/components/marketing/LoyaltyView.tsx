import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Percent } from 'lucide-react';
import toast from 'react-hot-toast';

import { loyaltyApi } from '../../api/services';
import type { LoyaltySettings } from '../../types';
import { LoadingBlock, SaveButton, SectionCard, Toggle } from './marketingKit';

export default function LoyaltyView() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
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

  if (isLoading || !settings) return <LoadingBlock />;

  return (
    <div className="space-y-5">
      <SectionCard
        icon={Gift}
        iconClass="bg-rose-50 text-rose-600"
        title="Программа лояльности"
        subtitle="Бонусы клиентам за заказы — начисление и списание при оплате"
        right={<Toggle checked={!!form.enabled} onChange={(v) => set({ enabled: v })} label="Программа лояльности" />}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Начисление, % от чека</label>
              <div className="flex items-center">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.accrualPercent ?? 0}
                  onChange={(e) => set({ accrualPercent: clampPct(parseInt(e.target.value) || 0) })}
                  className="input rounded-r-none"
                />
                <span className="flex items-center rounded-r-lg border border-l-0 border-gray-300 bg-gray-100 px-3 py-2.5 text-gray-500">
                  <Percent className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">Сколько бонусов начисляется с каждого заказа</p>
            </div>
            <div>
              <label className="label">Оплата бонусами, до %</label>
              <div className="flex items-center">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.redeemMaxPercent ?? 0}
                  onChange={(e) => set({ redeemMaxPercent: clampPct(parseInt(e.target.value) || 0) })}
                  className="input rounded-r-none"
                />
                <span className="flex items-center rounded-r-lg border border-l-0 border-gray-300 bg-gray-100 px-3 py-2.5 text-gray-500">
                  <Percent className="h-4 w-4" />
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">Какую часть чека можно закрыть бонусами</p>
            </div>
          </div>

          {!form.enabled && (
            <p className="rounded-xl bg-gray-50 px-3.5 py-3 text-xs text-gray-500">
              Программа выключена: новые бонусы не начисляются, но накопленные клиентами бонусы остаются и их можно
              списать.
            </p>
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
      </SectionCard>
    </div>
  );
}
