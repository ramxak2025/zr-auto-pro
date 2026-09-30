/**
 * ResetOwnerPasswordSheet — менеджер сбрасывает пароль владельца СВОЕГО автосервиса
 * (POST /manager/tenants/:id/reset-owner-password; у суперадмина такого маршрута нет, он
 * правит пароль сотрудника в карточке). Пароль хранится только bcrypt-хэшем и позже не
 * восстановим, поэтому после успеха сразу показываем логин/пароль и даём «Поделиться».
 */
import React from 'react';
import { Alert, Share } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { managerApi } from '../../api/services';
import { haptic } from '../../platform/haptics';
import { extractApiErrorMessage } from '../../utils/apiError';
import { formatPhone } from '../../../../shared/validation/phone';
import { invalidatePlatformQueries } from './adminShared';
import { AdminSheet, SheetHint, SheetPasswordField } from './adminSheet';

const MIN_PASSWORD = 6;

export interface ResetOwnerTarget {
  id: string;
  name: string;
  /** Владелец автосервиса (старший директор), если известен — попадёт в текст «Поделиться». */
  owner?: { fullName: string; phone: string } | null;
}

interface ResetOwnerPasswordSheetProps {
  visible: boolean;
  tenant: ResetOwnerTarget | null;
  onClose: () => void;
}

export default function ResetOwnerPasswordSheet({ visible, tenant, onClose }: ResetOwnerPasswordSheetProps) {
  const queryClient = useQueryClient();
  const [password, setPassword] = React.useState('');

  const wasVisible = React.useRef(false);
  React.useEffect(() => {
    if (visible && !wasVisible.current) setPassword('');
    wasVisible.current = visible;
  }, [visible]);

  const mutation = useMutation({
    mutationFn: async (next: string) => (await managerApi.resetOwnerPassword(tenant!.id, { password: next })).data,
    onSuccess: (_res, next) => {
      haptic('success');
      invalidatePlatformQueries(queryClient, tenant?.id);
      onClose();
      const phone = tenant?.owner?.phone ? formatPhone(tenant.owner.phone) : '';
      const creds = `Автосервис «${tenant?.name ?? ''}»${
        tenant?.owner?.fullName ? `\n${tenant.owner.fullName}` : ''
      }${phone ? `\nТелефон: ${phone}` : ''}\nНовый пароль: ${next}`;
      Alert.alert('Пароль владельца изменён', creds, [
        {
          text: 'Поделиться',
          onPress: () => {
            // expo-clipboard в проекте нет — «Скопировать» доступно в системном share-листе.
            Share.share({ message: `Autexa — вход\n${creds}` }).catch(() => {});
          },
        },
        { text: 'Готово', style: 'cancel' },
      ]);
    },
    onError: (err) => {
      haptic('error');
      Alert.alert('Не удалось сбросить пароль', extractApiErrorMessage(err, 'Попробуйте ещё раз'));
    },
  });

  if (!tenant) return null;

  const submit = () => {
    if (password.length < MIN_PASSWORD) {
      haptic('error');
      Alert.alert('Слишком короткий пароль', `Пароль — не короче ${MIN_PASSWORD} символов.`);
      return;
    }
    mutation.mutate(password);
  };

  return (
    <AdminSheet
      visible={visible}
      title="Пароль владельца"
      saveLabel="Сбросить"
      saving={mutation.isPending}
      onClose={onClose}
      onSave={submit}
    >
      <SheetPasswordField
        label={`Новый пароль владельца «${tenant.name}»`}
        value={password}
        onChangeText={setPassword}
        placeholder={`Не короче ${MIN_PASSWORD} символов`}
      />
      <SheetHint icon="information-circle-outline">
        Владелец войдёт по этому паролю. Прежний пароль перестанет работать; сообщите новый владельцу.
      </SheetHint>
    </AdminSheet>
  );
}
