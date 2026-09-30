/**
 * ManagerCreateTenantSheet — менеджер заводит автосервис ЗА СЕБЯ: название, контакты, тариф,
 * владелец-директор (имя, телефон-логин, пароль) и пробный доступ (7/14/30 дней, не больше
 * `maxFreeDays` платформы). Города в форме нет — контракт менеджера его не принимает.
 * Бессрочных автосервисов менеджер не создаёт: без `trialDays` сервер сам выдаёт
 * min(14, maxFreeDays) дней, поэтому срок всегда отправляем явно.
 */
import React from 'react';
import { Alert, Share } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { managerApi, plansApi } from '../../api/services';
import { haptic } from '../../platform/haptics';
import { extractApiErrorMessage } from '../../utils/apiError';
import { formatPhone, isCompletePhone, normalizePhone } from '../../../../shared/validation/phone';
import type { ManagerSummary, Plan, Tenant } from '../../../../shared/types';
import type { CreateManagerTenantRequest } from '../../../../shared/api/types';
import { formatMoney, invalidatePlatformQueries } from './adminShared';
import {
  AdminSheet,
  SheetChips,
  SheetHint,
  SheetInput,
  SheetLabel,
  SheetOptionRow,
  SheetPasswordField,
} from './adminSheet';

const MIN_PASSWORD = 6;
/** Пресеты пробного доступа, дни; каждый режется лимитом платформы. */
const TRIAL_PRESETS = [7, 14, 30];
const DEFAULT_TRIAL_DAYS = 14;

interface ManagerCreateTenantSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Вызывается по нажатию «Открыть» в подтверждении — экран открывает карточку автосервиса. */
  onOpenTenant?: (tenant: Tenant) => void;
}

export default function ManagerCreateTenantSheet({ visible, onClose, onOpenTenant }: ManagerCreateTenantSheetProps) {
  const queryClient = useQueryClient();
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [planId, setPlanId] = React.useState('');
  const [ownerName, setOwnerName] = React.useState('');
  const [ownerPhone, setOwnerPhone] = React.useState('');
  const [ownerPassword, setOwnerPassword] = React.useState('');
  const [trialDays, setTrialDays] = React.useState('');
  const [note, setNote] = React.useState('');

  const wasVisible = React.useRef(false);
  React.useEffect(() => {
    if (visible && !wasVisible.current) {
      setName('');
      setPhone('');
      setAddress('');
      setPlanId('');
      setOwnerName('');
      setOwnerPhone('');
      setOwnerPassword('');
      setTrialDays('');
      setNote('');
    }
    wasVisible.current = visible;
  }, [visible]);

  const { data: plans } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => (await plansApi.getAll()).data,
    enabled: visible,
    placeholderData: (prev) => prev,
  });
  const { data: summary } = useQuery<ManagerSummary>({
    queryKey: ['manager', 'summary'],
    queryFn: async () => (await managerApi.summary()).data,
    enabled: visible,
    placeholderData: (prev) => prev,
  });

  const activePlans = React.useMemo(
    () => (plans ?? []).filter((p) => p.isActive).sort((a, b) => a.sortOrder - b.sortOrder),
    [plans],
  );
  // Тариф по умолчанию — первый активный; выбранный вручную главнее.
  const effectivePlanId = planId || activePlans[0]?.id || '';

  const maxFree = Math.max(1, Math.floor(summary?.maxFreeDays ?? 30));
  const defaultTrial = Math.min(DEFAULT_TRIAL_DAYS, maxFree);
  const trialPresets = React.useMemo(
    () => Array.from(new Set(TRIAL_PRESETS.map((d) => Math.min(d, maxFree)))),
    [maxFree],
  );
  const effectiveTrial = trialDays === '' ? defaultTrial : Number(trialDays);

  const mutation = useMutation({
    mutationFn: async (req: CreateManagerTenantRequest) => (await managerApi.createTenant(req)).data,
    onSuccess: (tenant, req) => {
      haptic('success');
      invalidatePlatformQueries(queryClient);
      onClose();
      // Пароль владельца хранится хэшем и позже не восстановим — показываем и даём «Поделиться».
      const creds = `Автосервис «${req.name}»\n${req.director.name}\nТелефон: ${formatPhone(
        req.director.phone,
      )}\nПароль: ${req.director.password}`;
      Alert.alert('Автосервис создан', creds, [
        {
          text: 'Поделиться',
          onPress: () => {
            // expo-clipboard в проекте нет — «Скопировать» доступно в системном share-листе.
            Share.share({ message: `Autexa — вход\n${creds}` }).catch(() => {});
          },
        },
        ...(onOpenTenant ? [{ text: 'Открыть', onPress: () => onOpenTenant(tenant) }] : []),
        { text: 'Готово', style: 'cancel' as const },
      ]);
    },
    onError: (err) => {
      haptic('error');
      // 409 PHONE_TAKEN приходит с готовым текстом — показываем как есть.
      Alert.alert('Не удалось создать автосервис', extractApiErrorMessage(err, 'Попробуйте ещё раз'));
    },
  });

  const submit = () => {
    const fail = (title: string, message: string) => {
      haptic('error');
      Alert.alert(title, message);
    };
    if (!name.trim()) return fail('Укажите название', 'Название автосервиса обязательно.');
    if (phone.trim() && !isCompletePhone(phone))
      return fail('Проверьте телефон', 'Введите телефон автосервиса полностью: +7 и 10 цифр — или очистите поле.');
    if (!effectivePlanId) return fail('Выберите тариф', 'Тарифы ещё не загрузились или недоступны.');
    if (!ownerName.trim()) return fail('Укажите владельца', 'Имя владельца автосервиса обязательно.');
    if (!isCompletePhone(ownerPhone))
      return fail(
        'Проверьте телефон владельца',
        'Телефон — это логин владельца: введите номер полностью, +7 и 10 цифр.',
      );
    if (ownerPassword.length < MIN_PASSWORD)
      return fail('Слишком короткий пароль', `Пароль владельца — не короче ${MIN_PASSWORD} символов.`);
    if (!Number.isInteger(effectiveTrial) || effectiveTrial < 1)
      return fail('Укажите пробный срок', 'Введите число дней пробного доступа.');
    if (effectiveTrial > maxFree) return fail('Слишком много дней', `Пробный доступ — не больше ${maxFree} дн.`);
    mutation.mutate({
      name: name.trim(),
      ...(phone.trim() ? { phone: normalizePhone(phone) } : {}),
      ...(address.trim() ? { address: address.trim() } : {}),
      planId: effectivePlanId,
      director: { name: ownerName.trim(), phone: normalizePhone(ownerPhone), password: ownerPassword },
      trialDays: effectiveTrial,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <AdminSheet
      visible={visible}
      title="Новый автосервис"
      saveLabel="Создать"
      saving={mutation.isPending}
      onClose={onClose}
      onSave={submit}
    >
      <SheetInput label="Название" value={name} onChangeText={setName} placeholder="Автосервис «Мотор»" />
      <SheetInput
        label="Телефон автосервиса"
        value={phone}
        onChangeText={(v) => setPhone(formatPhone(v))}
        placeholder="Необязательно"
        keyboardType="phone-pad"
      />
      <SheetInput label="Адрес" value={address} onChangeText={setAddress} placeholder="Необязательно" />

      <SheetLabel>Тариф</SheetLabel>
      {activePlans.map((p) => (
        <SheetOptionRow
          key={p.id}
          title={p.name}
          subtitle={`${formatMoney(p.monthlyPrice)}/мес · до ${p.maxUsers} польз.`}
          selected={effectivePlanId === p.id}
          onPress={() => setPlanId(p.id)}
        />
      ))}

      <SheetInput label="Владелец — имя" value={ownerName} onChangeText={setOwnerName} placeholder="Иван Петров" />
      <SheetInput
        label="Владелец — телефон (логин)"
        value={ownerPhone}
        onChangeText={(v) => setOwnerPhone(formatPhone(v))}
        placeholder="+7 (___) ___-__-__"
        keyboardType="phone-pad"
      />
      <SheetPasswordField
        label="Пароль владельца"
        value={ownerPassword}
        onChangeText={setOwnerPassword}
        placeholder={`Не короче ${MIN_PASSWORD} символов`}
      />

      <SheetLabel>Пробный доступ, дней</SheetLabel>
      <SheetChips
        chips={trialPresets.map((d) => ({
          label: `${d} дн.`,
          active: effectiveTrial === d,
          onPress: () => {
            haptic('select');
            setTrialDays(String(d));
          },
        }))}
      />
      <SheetInput
        value={trialDays}
        onChangeText={(v) => setTrialDays(v.replace(/[^0-9]/g, ''))}
        placeholder={`${defaultTrial}`}
        keyboardType="number-pad"
      />
      <SheetHint icon="information-circle-outline">
        Пробный доступ не считается оплатой и долга не создаёт. Не больше {maxFree} дн. Дальше — платное продление.
      </SheetHint>

      <SheetInput label="Заметка" value={note} onChangeText={setNote} placeholder="Видна только вам" multiline />
    </AdminSheet>
  );
}
