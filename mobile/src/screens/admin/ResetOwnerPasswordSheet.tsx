import React from 'react';
import { Alert, Share } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { formatPhone } from '../../../../shared/validation/phone';
import { invalidatePlatformQueries } from './adminShared';
import { AdminSheet, SheetHint, SheetPasswordField } from './adminSheet';
import { usePlatformSession } from './usePlatformData';
import { assertPlatformSession } from './platformSession';
export interface ResetOwnerTarget {
  id: string;
  name: string;
  owner?: { fullName: string; phone: string } | null;
}
interface ResetProps {
  visible: boolean;
  tenant: ResetOwnerTarget | null;
  onClose: () => void;
}
export default function ResetOwnerPasswordSheet(props: ResetProps) {
  const { session } = usePlatformSession();
  return (
    <ResetPasswordContent key={`${props.tenant?.id}:${session.data.generation}:${session.authEpoch}`} {...props} />
  );
}
function ResetPasswordContent({ visible, tenant, onClose }: ResetProps) {
  const client = useQueryClient(),
    { session, allowed } = usePlatformSession();
  const [password, setPassword] = React.useState(''),
    [saving, setSaving] = React.useState(false);
  const scope = React.useRef({ visible, id: tenant?.id });
  scope.current = { visible, id: tenant?.id };
  React.useEffect(() => {
    setPassword('');
  }, [visible, tenant?.id]);
  if (!tenant) return null;
  const submit = async () => {
    if (!allowed || saving || !visible) return;
    if (password.length < 6) {
      Alert.alert('Слишком короткий пароль', 'Введите не менее 6 символов.');
      return;
    }
    const target = tenant,
      next = password;
    setSaving(true);
    try {
      assertPlatformSession(session);
      await session.manager.resetOwnerPassword(target.id, { password: next });
      assertPlatformSession(session);
      if (!scope.current.visible || scope.current.id !== target.id) return;
      setPassword('');
      invalidatePlatformQueries(client, target.id);
      onClose();
      const message = `Autexa · ${target.name}${target.owner?.phone ? `\nТелефон: ${formatPhone(target.owner.phone)}` : ''}\nНовый пароль: ${next}`;
      Alert.alert('Новый пароль · покажем один раз', message, [
        {
          text: 'Поделиться',
          onPress: () => {
            if (session.isCurrent()) void Share.share({ message }).catch(() => {});
          },
        },
        { text: 'Готово', style: 'cancel' },
      ]);
    } catch {
      if (session.isCurrent() && scope.current.visible && scope.current.id === target.id)
        Alert.alert('Не удалось подтвердить смену пароля', 'Повторите запрос с тем же паролем.');
    } finally {
      if (session.isCurrent()) setSaving(false);
    }
  };
  return (
    <AdminSheet
      visible={visible}
      title="Пароль владельца"
      saveLabel="Сбросить"
      saving={saving}
      onClose={onClose}
      onSave={() => void submit()}
    >
      <SheetPasswordField
        label={`Новый пароль · ${tenant.name}`}
        value={password}
        onChangeText={setPassword}
        placeholder="Не менее 6 символов"
      />
      <SheetHint icon="information-circle-outline">
        Текущий пароль восстановить нельзя: он хранится в защищённом виде. Сброс необратим, прежний пароль перестанет
        работать. Новый пароль покажем один раз после успешного сброса.
      </SheetHint>
    </AdminSheet>
  );
}
