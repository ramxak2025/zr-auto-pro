/**
 * ManagerFormSheet — создание и правка менеджера платформы (только суперадмин):
 * ФИО, телефон-логин, пароль, доля владельца, активность, заметка.
 * Смена доли действует на БУДУЩИЕ платежи (у прошлых доля — снимок).
 */
import React from 'react';
import { Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { adminManagersApi } from '../../api/services';
import { haptic } from '../../platform/haptics';
import { extractApiErrorMessage } from '../../utils/apiError';
import { formatPhone, normalizePhone, isValidPhone } from '../../../../shared/validation/phone';
import type { PlatformManager } from '../../../../shared/types';
import type { UpdateManagerRequest } from '../../../../shared/api/types';
import { formatPercent, invalidatePlatformQueries } from './adminShared';
import { AdminSheet, SheetHint, SheetInput, SheetPasswordField, SheetSwitchRow } from './adminSheet';

/** Доля владельца по умолчанию — как на сервере (`owner_share_percent`). */
const DEFAULT_OWNER_SHARE = '60';
const MIN_PASSWORD = 6;

/** «60», «33,5», «33.5» → число 0..100 с точностью до сотых; иначе null. */
function parsePercent(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!text) return null;
  const v = Number(text);
  if (!Number.isFinite(v) || v < 0 || v > 100) return null;
  return Math.round(v * 100) / 100;
}

interface ManagerFormSheetProps {
  visible: boolean;
  /** null — новый менеджер; иначе правка существующего. */
  manager: PlatformManager | null;
  onClose: () => void;
  onSaved?: (manager: PlatformManager) => void;
}

export default function ManagerFormSheet({ visible, manager, onClose, onSaved }: ManagerFormSheetProps) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [share, setShare] = React.useState(DEFAULT_OWNER_SHARE);
  const [isActive, setIsActive] = React.useState(true);
  const [note, setNote] = React.useState('');

  // Форма открывается со свежими значениями менеджера (или пустой); пока шторка открыта,
  // фоновое обновление списка не должно затирать то, что уже введено.
  const wasVisible = React.useRef(false);
  React.useEffect(() => {
    if (visible && !wasVisible.current) {
      setFullName(manager?.fullName ?? '');
      setPhone(manager?.phone ? formatPhone(manager.phone) : '');
      setPassword('');
      setShare(manager ? String(manager.ownerSharePercent) : DEFAULT_OWNER_SHARE);
      setIsActive(manager?.isActive ?? true);
      setNote(manager?.note ?? '');
    }
    wasVisible.current = visible;
  }, [visible, manager]);

  const saveMutation = useMutation({
    mutationFn: async (): Promise<PlatformManager | null> => {
      const pct = parsePercent(share) as number;
      if (!manager) {
        const res = await adminManagersApi.create({
          fullName: fullName.trim(),
          phone: normalizePhone(phone),
          password,
          ownerSharePercent: pct,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
        return res.data;
      }
      // Шлём только изменённое: лишний PATCH-ключ сервер писал бы в журнал как правку.
      const body: UpdateManagerRequest = {};
      if (fullName.trim() !== manager.fullName) body.fullName = fullName.trim();
      if (normalizePhone(phone) !== normalizePhone(manager.phone)) body.phone = normalizePhone(phone);
      if (pct !== manager.ownerSharePercent) body.ownerSharePercent = pct;
      if (isActive !== manager.isActive) body.isActive = isActive;
      if (password) body.password = password;
      const nextNote = note.trim();
      if (nextNote !== (manager.note ?? '')) body.note = nextNote || null;
      if (Object.keys(body).length === 0) return null;
      const res = await adminManagersApi.update(manager.id, body);
      return res.data;
    },
    onSuccess: (saved) => {
      haptic('success');
      invalidatePlatformQueries(queryClient);
      if (saved) onSaved?.(saved);
      onClose();
    },
    onError: (error) => {
      haptic('error');
      // 409 PHONE_TAKEN приходит с готовым текстом — показываем как есть.
      Alert.alert('Не удалось сохранить', extractApiErrorMessage(error, 'Попробуйте ещё раз'));
    },
  });

  const handleSave = () => {
    if (!fullName.trim()) {
      Alert.alert('Укажите имя', 'ФИО менеджера обязательно.');
      return;
    }
    if (!isValidPhone(phone)) {
      Alert.alert('Проверьте телефон', 'Телефон — это логин менеджера, нужно не меньше 10 цифр.');
      return;
    }
    if ((!manager || password) && password.length < MIN_PASSWORD) {
      Alert.alert('Слишком короткий пароль', `Пароль — не короче ${MIN_PASSWORD} символов.`);
      return;
    }
    if (parsePercent(share) === null) {
      Alert.alert('Проверьте долю владельца', 'Доля владельца — число от 0 до 100 процентов.');
      return;
    }
    saveMutation.mutate();
  };

  const pct = parsePercent(share);

  return (
    <AdminSheet
      visible={visible}
      title={manager ? 'Менеджер' : 'Новый менеджер'}
      saveLabel={manager ? 'Сохранить' : 'Создать'}
      saving={saveMutation.isPending}
      onClose={onClose}
      onSave={handleSave}
    >
      <SheetInput label="Имя и фамилия" value={fullName} onChangeText={setFullName} placeholder="Иван Петров" />
      <SheetInput
        label="Телефон (логин)"
        value={phone}
        onChangeText={(v) => setPhone(formatPhone(v))}
        placeholder="+7 (___) ___-__-__"
        keyboardType="phone-pad"
      />
      <SheetPasswordField
        label={manager ? 'Новый пароль' : 'Пароль'}
        value={password}
        onChangeText={setPassword}
        placeholder={manager ? 'Оставьте пустым, чтобы не менять' : `Не короче ${MIN_PASSWORD} символов`}
      />
      <SheetInput
        label="Доля владельца, %"
        value={share}
        onChangeText={setShare}
        placeholder={DEFAULT_OWNER_SHARE}
        keyboardType="decimal-pad"
      />
      <SheetHint icon="information-circle-outline">
        {pct === null
          ? 'Сколько процентов каждой платной оплаты менеджер передаёт владельцу.'
          : `С каждой платной оплаты ${formatPercent(pct)} записывается в долг менеджера владельцу, ${formatPercent(
              100 - pct,
            )} остаётся менеджеру.${manager ? ' Новая доля действует на будущие оплаты — прошлые не пересчитываются.' : ''}`}
      </SheetHint>
      {manager ? (
        <>
          <SheetSwitchRow label="Менеджер активен" value={isActive} onValueChange={setIsActive} />
          {!isActive ? (
            <SheetHint icon="alert-circle-outline">
              Менеджер не сможет войти, его автосервисы остаются за ним.
            </SheetHint>
          ) : null}
        </>
      ) : null}
      <SheetInput label="Заметка" value={note} onChangeText={setNote} placeholder="Видна только вам" multiline />
    </AdminSheet>
  );
}
