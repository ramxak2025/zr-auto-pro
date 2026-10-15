import { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { captureDataSession } from '../contexts/dataSession';

type PhotoNavigation = {
  addListener?: (event: 'blur', listener: () => void) => () => void;
  isFocused?: () => boolean;
};

// Local to the two product editors: a native picker result belongs to the
// exact form opening and data session that requested it, even after A → B → A.
export function useProductPhotoPicker({
  active,
  formKey,
  navigation,
  onChange,
}: {
  active: boolean;
  formKey: string;
  navigation: PhotoNavigation;
  onChange: (uri: string) => void;
}) {
  const latest = useRef({ active, formKey, onChange });
  latest.current = { active, formKey, onChange };
  const generation = useRef(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  const [isPicking, setIsPicking] = useState(false);
  const invalidate = useCallback(() => {
    generation.current += 1;
  }, []);

  useEffect(invalidate, [active, formKey, invalidate]);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = navigation.addListener?.('blur', invalidate);
    return () => {
      mounted.current = false;
      invalidate();
      unsubscribe?.();
    };
  }, [navigation, invalidate]);

  const captureContinuation = useCallback(() => {
    const session = captureDataSession();
    const opening = generation.current;
    const key = latest.current.formKey;
    return {
      isCurrent: () =>
        mounted.current &&
        latest.current.active &&
        latest.current.formKey === key &&
        opening === generation.current &&
        session.isCurrent() &&
        (navigation.isFocused?.() ?? true),
    };
  }, [navigation]);

  const pickImage = useCallback(() => {
    if (busy.current || !latest.current.active) return;
    busy.current = true; // Lock before presenting UI; a second tap may precede a render.
    setIsPicking(true);
    const continuation = captureContinuation();
    const finish = () => {
      busy.current = false;
      if (mounted.current) setIsPicking(false);
    };
    let selected = false;
    const choose = async (source: 'camera' | 'library' | null) => {
      if (selected) return;
      selected = true;
      try {
        if (!source || !continuation.isCurrent()) return;
        if (source === 'camera') {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!continuation.isCurrent()) return;
          if (!permission.granted) {
            Alert.alert(
              'Нет доступа к камере',
              permission.canAskAgain
                ? 'Разрешите доступ к камере, чтобы сфотографировать товар. Можно также выбрать фото из галереи.'
                : 'Доступ к камере отключён. Разрешите его в настройках или выберите фото из галереи.',
              [
                { text: 'Отмена', style: 'cancel' },
                ...(!permission.canAskAgain
                  ? [
                      {
                        text: 'Настройки',
                        onPress: () => {
                          if (!continuation.isCurrent()) return;
                          void Linking.openSettings().catch(() => {
                            if (continuation.isCurrent())
                              Alert.alert(
                                'Настройки недоступны',
                                'Откройте настройки телефона и разрешите Autexa доступ к камере.',
                              );
                          });
                        },
                      },
                    ]
                  : []),
              ],
            );
            return;
          }
        }
        const options: ImagePicker.ImagePickerOptions = {
          mediaTypes: ['images'],
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        };
        const result = await (source === 'camera'
          ? ImagePicker.launchCameraAsync(options)
          : ImagePicker.launchImageLibraryAsync(options));
        if (continuation.isCurrent() && !result.canceled && result.assets[0]?.uri) {
          latest.current.onChange(result.assets[0].uri);
        }
      } catch {
        if (continuation.isCurrent())
          Alert.alert('Не удалось открыть фото', 'Попробуйте ещё раз или выберите другой способ добавления фото.');
      } finally {
        finish();
      }
    };
    try {
      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          {
            title: 'Фото товара',
            options: ['Сфотографировать', 'Выбрать из галереи', 'Отмена'],
            cancelButtonIndex: 2,
          },
          (index) => {
            void choose(index === 0 ? 'camera' : index === 1 ? 'library' : null);
          },
        );
      } else {
        Alert.alert(
          'Фото товара',
          undefined,
          [
            {
              text: 'Сфотографировать',
              onPress: () => {
                void choose('camera');
              },
            },
            {
              text: 'Выбрать из галереи',
              onPress: () => {
                void choose('library');
              },
            },
            {
              text: 'Отмена',
              style: 'cancel',
              onPress: () => {
                void choose(null);
              },
            },
          ],
          { cancelable: true, onDismiss: finish },
        );
      }
    } catch {
      finish();
      if (continuation.isCurrent()) Alert.alert('Не удалось открыть фото', 'Попробуйте ещё раз.');
    }
  }, [captureContinuation]);

  return { pickImage, isPicking, invalidate, captureContinuation };
}
