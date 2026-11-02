import React, { useState } from 'react';
import { Alert, Share } from 'react-native';
import Constants from 'expo-constants';
import { productsApi } from '../api/services';
import { captureDataSession } from '../contexts/dataSession';
import { Button } from './Button';

export default function ProductShareButton({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const share = async () => {
    if (busy) return;
    const origin = process.env.EXPO_PUBLIC_WEB_URL || Constants.expoConfig?.extra?.publicWebUrl;
    if (typeof origin !== 'string' || !/^https?:\/\//.test(origin)) {
      Alert.alert('Ссылка пока недоступна', 'Для этой версии не настроен адрес публичного сайта.');
      return;
    }
    const lease = captureDataSession();
    setBusy(true);
    try {
      const response = await productsApi.createShare(id);
      if (!lease.isCurrent()) return;
      const url = new URL(response.data.path, origin).href;
      await Share.share({ title: name, message: `${name}\n${url}`, url });
    } catch {
      if (lease.isCurrent()) Alert.alert('Не удалось поделиться', 'Проверьте подключение и попробуйте ещё раз.');
    } finally {
      if (lease.isCurrent()) setBusy(false);
    }
  };
  return <Button title="Поделиться товаром" variant="secondary" onPress={() => void share()} loading={busy} />;
}
