/**
 * ClientCarPickerSheet — выбор автомобиля клиента при подстановке в чек
 * (Касса, Round 7 #8 — поиск по телефону).
 *
 * Поиск по ТЕЛЕФОНУ возвращает КЛИЕНТОВ, а чек хочет пару клиент+авто.
 * Родитель (CheckCreateScreen) решает по числу машин:
 *   • 0 авто → клиент подставляется без машины (пикер не открывается);
 *   • 1 авто → клиент + эта машина сразу (пикер не открывается);
 *   • ≥2 авто → ЭТОТ sheet: одна строка на авто — ГОСТ-бейдж номера
 *     (GostPlateBadge, как в поиске по госномеру у Клиентов) + марка/модель.
 *     Тап по строке → onPick(client, car) → родитель прогоняет тот же
 *     setClientId/setCarId путь, что и выбор по госномеру.
 *
 * Презентация — BottomSheet, тот же паттерн, что QuickClientCreateSheet.
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { BottomSheet } from './BottomSheet';
import GostPlateBadge from './GostPlateBadge';
import { useColors } from '../contexts/ThemeContext';
import { formatPhone } from '../../../shared/validation/phone';
import { spacing, borderRadius } from '../theme';
import type { Client, Car } from '../../../shared/types';

interface ClientCarPickerSheetProps {
  visible: boolean;
  /** Клиент, у которого выбираем машину (null, пока sheet закрыт). */
  client: Client | null;
  onClose: () => void;
  /** Выбранная пара уходит в чек тем же путём, что и plate-поиск. */
  onPick: (client: Client, car: Car) => void;
}

const PLATE_H = 40; // тот же рост бейджа, что в PlateResultCard (Клиенты)

export default function ClientCarPickerSheet({ visible, client, onClose, onPick }: ClientCarPickerSheetProps) {
  const palette = useColors();
  const cars = client?.cars || [];

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Выберите автомобиль" heightRatio={0.62}>
      {client && (
        <View style={styles.clientRow}>
          <View style={[styles.clientAvatar, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="person" size={16} color={palette.text.secondary} />
          </View>
          <View style={styles.clientInfo}>
            <Text variant="bodyEmph" color={palette.text.primary} numberOfLines={1}>
              {client.fullName}
            </Text>
            {!!client.phone && (
              <Text variant="footnote" color={palette.text.tertiary} numberOfLines={1}>
                {formatPhone(client.phone)}
              </Text>
            )}
          </View>
        </View>
      )}

      <View style={[styles.list, { borderColor: palette.border.subtle, backgroundColor: palette.bg.card }]}>
        {cars.map((car, index) => (
          <TouchableOpacity
            key={car.id}
            activeOpacity={0.6}
            onPress={() => client && onPick(client, car)}
            style={[
              styles.carRow,
              index < cars.length - 1 && [styles.carRowDivider, { borderBottomColor: palette.border.subtle }],
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Выбрать автомобиль ${car.plateNumber || car.makeModel || ''}`}
          >
            <GostPlateBadge plate={car.plateNumber || ''} height={PLATE_H} />
            <View style={styles.carInfo}>
              <Text variant="bodyEmph" color={palette.text.primary} numberOfLines={1} style={styles.carMake}>
                {car.makeModel || 'Без модели'}
              </Text>
              {!!car.comment && (
                <Text variant="footnote" color={palette.text.tertiary} numberOfLines={1}>
                  {car.comment}
                </Text>
              )}
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
          </TouchableOpacity>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    marginBottom: spacing[3],
  },
  clientAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientInfo: { flex: 1, minWidth: 0 },
  // Inset-grouped список машин — та же визуальная группа, что plate-результаты
  // на экране Клиентов (непрерывная поверхность, hairline-разделители).
  list: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
  },
  carRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  carRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  carInfo: { flex: 1, minWidth: 0, gap: 2 },
  carMake: { fontSize: 15, letterSpacing: -0.1 },
});
