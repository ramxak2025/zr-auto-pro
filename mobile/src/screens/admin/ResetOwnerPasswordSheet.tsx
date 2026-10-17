import React from 'react';
import { Alert, Pressable, Share } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
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
    palette = useColors(),
    { session, allowed } = usePlatformSession();
  const [password, setPassword] = React.useState(''),
    [saving, setSaving] = React.useState(false),
    [success, setSuccess] = React.useState<{ message: string; generation: number } | null>(null);
  const scope = React.useRef({ mounted: false, visible, id: tenant?.id, generation: 0, pending: false });
  // Invalidate at the render boundary as well as in close/cleanup: an old promise
  // must not commit between the new props and the layout-effect cleanup.
  if (scope.current.visible !== visible || scope.current.id !== tenant?.id) {
    scope.current.generation += 1;
    scope.current.visible = visible;
    scope.current.id = tenant?.id;
    scope.current.pending = false;
  }
  React.useLayoutEffect(() => {
    scope.current.mounted = true;
    return () => {
      scope.current.mounted = false;
      scope.current.generation += 1;
      scope.current.pending = false;
    };
  }, []);
  React.useLayoutEffect(() => {
    setPassword('');
    setSuccess(null);
    setSaving(false);
  }, [visible, tenant?.id]);
  if (!tenant) return null;
  const generation = scope.current.generation;
  const isCurrentOpen = (attempt: number) =>
    session.isCurrent() &&
    scope.current.mounted &&
    scope.current.visible &&
    scope.current.id === tenant.id &&
    scope.current.generation === attempt;
  const close = () => {
    if (!isCurrentOpen(generation)) return;
    scope.current.generation += 1;
    scope.current.visible = false;
    scope.current.pending = false;
    setPassword('');
    setSuccess(null);
    setSaving(false);
    onClose();
  };
  const submit = async () => {
    if (!allowed || scope.current.pending || !isCurrentOpen(generation)) return;
    if (password.length < 6) {
      Alert.alert('Слишком короткий пароль', 'Введите не менее 6 символов.');
      return;
    }
    const target = tenant,
      next = password;
    scope.current.pending = true;
    setSaving(true);
    try {
      assertPlatformSession(session);
      await session.manager.resetOwnerPassword(target.id, { password: next });
      if (!isCurrentOpen(generation)) return;
      setPassword('');
      invalidatePlatformQueries(client, target.id);
      // The response does not identify the director chosen by the server. Never
      // associate this credential with a cached owner's name or phone.
      setSuccess({ message: `Autexa · ${target.name}\nНовый пароль: ${next}`, generation });
    } catch {
      if (isCurrentOpen(generation))
        Alert.alert('Не удалось подтвердить смену пароля', 'Повторите запрос с тем же паролем.');
    } finally {
      if (isCurrentOpen(generation)) {
        scope.current.pending = false;
        setSaving(false);
      }
    }
  };
  const currentSuccess = success?.generation === generation && isCurrentOpen(generation) ? success : null;
  return (
    <AdminSheet
      visible={visible}
      title="Пароль владельца"
      saveLabel={currentSuccess ? 'Готово' : 'Сбросить'}
      saving={saving}
      onClose={close}
      onSave={currentSuccess ? close : () => void submit()}
    >
      {currentSuccess ? (
        <>
          <Text variant="title3" color={palette.text.primary}>
            Новый пароль · покажем один раз
          </Text>
          <Text selectable color={palette.text.primary}>
            {currentSuccess.message}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Поделиться новым паролем"
            style={{ minHeight: 48, justifyContent: 'center' }}
            onPress={() => {
              if (isCurrentOpen(currentSuccess.generation))
                void Share.share({ message: currentSuccess.message }).catch(() => {});
            }}
          >
            <Text variant="callout" color={palette.accent.primary}>
              Поделиться
            </Text>
          </Pressable>
          <SheetHint icon="information-circle-outline">
            После закрытия формы пароль исчезнет. Его нельзя восстановить из приложения.
          </SheetHint>
        </>
      ) : (
        <>
          <SheetPasswordField
            label={`Новый пароль · ${tenant.name}`}
            value={password}
            onChangeText={setPassword}
            placeholder="Не менее 6 символов"
          />
          <SheetHint icon="information-circle-outline">
            Текущий пароль восстановить нельзя: он хранится в защищённом виде. Сброс необратим, прежний пароль
            перестанет работать. Новый пароль покажем один раз после успешного сброса.
          </SheetHint>
        </>
      )}
    </AdminSheet>
  );
}
