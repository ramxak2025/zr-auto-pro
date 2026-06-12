/**
 * QuickClientCreateSheet — быстрое создание клиента прямо из Кассы.
 *
 * Открывается из состояния «Клиент не найден» поиска по госномеру, чтобы
 * касса не превращалась в тупик: имя + телефон + (предзаполненный из поиска)
 * госномер + марка/модель — и клиент с авто сразу подставляются в чек.
 *
 * Поток повторяет проверенную последовательность ClientsScreen:
 *   1. `clientsApi.lookupByPhone` — дубликат по телефону → DuplicateWarningDialog;
 *   2. `carsApi.lookupByPlate` — дубликат по номеру → DuplicateWarningDialog;
 *   3. `clientsApi.create`, затем `carsApi.create` с clientId из ответа
 *      (двухшаговый — CreateClientRequest не принимает машину inline).
 *
 * Отличие от ClientsScreen: «Открыть существующего» здесь означает «подставить
 * существующего клиента/владельца в чек» (через onSelectExisting), а не
 * навигацию в карточку — мы внутри кассового флоу.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { clientsApi, carsApi } from '../api/services';
import { BottomSheet } from './BottomSheet';
import RussianPlateInput from './RussianPlateInput';
import PlateModeSwitcher, { type PlateMode } from './PlateModeSwitcher';
import DuplicateWarningDialog from './DuplicateWarningDialog';
import { normalizePlateForSearch } from '../utils/plateMask';
import { formatPhone } from '../../../shared/validation/phone';
import { haptic } from '../platform/haptics';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Client, Car } from '../../../shared/types';

interface QuickClientCreateSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Предзаполнение из поиска Кассы — чистая строка номера. */
  initialPlate: string;
  initialPlateMode: PlateMode;
  /** Клиент (и опционально авто) созданы — родитель подставляет их в чек. */
  onCreated: (client: Client, car: Car | null) => void;
  /** Найден существующий клиент/владелец — родитель подставляет его в чек. */
  onSelectExisting: (clientId: string, carId?: string) => void;
}

type DuplicateClient = {
  id: string;
  fullName: string;
  phone: string;
  cars?: Array<{ id: string; plateNumber: string; makeModel: string }>;
};

type DuplicateCar = {
  id: string;
  plateNumber: string;
  makeModel: string;
  clientId: string | null;
  client: { id: string; fullName: string; phone: string } | null;
};

export default function QuickClientCreateSheet({
  visible,
  onClose,
  initialPlate,
  initialPlateMode,
  onCreated,
  onSelectExisting,
}: QuickClientCreateSheetProps) {
  const queryClient = useQueryClient();
  const palette = useColors();

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [plate, setPlate] = useState('');
  const [plateMode, setPlateMode] = useState<PlateMode>('ru');
  const [makeModel, setMakeModel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [duplicateClient, setDuplicateClient] = useState<DuplicateClient | null>(null);
  const [duplicateCar, setDuplicateCar] = useState<DuplicateCar | null>(null);

  // Каждое открытие — чистая форма с номером из поиска (в текущем режиме
  // RU/INT), чтобы не перенабирать то, что уже введено в Кассе.
  useEffect(() => {
    if (!visible) return;
    setFullName('');
    setPhone('');
    setMakeModel('');
    setPlate(initialPlate);
    setPlateMode(initialPlateMode);
    setDuplicateClient(null);
    setDuplicateCar(null);
    setSubmitting(false);
  }, [visible, initialPlate, initialPlateMode]);

  /** Создание: (опц. проверка дубля по номеру) → клиент → авто. */
  const submitFlow = async (opts?: { forceCar?: boolean }) => {
    const cleanPlate = plate.trim();
    // Дубликат по номеру важен только когда номер реально введён.
    if (cleanPlate.length > 0 && !opts?.forceCar) {
      try {
        const res = await carsApi.lookupByPlate(cleanPlate);
        if (res.data) {
          setDuplicateCar(res.data);
          return;
        }
      } catch {
        // best-effort — при сбое проверки продолжаем создание.
      }
    }
    setSubmitting(true);
    try {
      const clientRes = await clientsApi.create({ fullName: fullName.trim(), phone });
      let car: Car | null = null;
      if (cleanPlate.length > 0 || makeModel.trim().length > 0) {
        const carRes = await carsApi.create({
          plateNumber: cleanPlate,
          makeModel: makeModel.trim(),
          clientId: clientRes.data.id,
        });
        car = carRes.data;
      }
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clients-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['clients-plate'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      haptic('success');
      onCreated(clientRes.data, car);
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать клиента');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!fullName.trim() || !phone.trim()) {
      Alert.alert('Ошибка', 'Укажите имя и телефон клиента');
      return;
    }
    setSubmitting(true);
    try {
      const res = await clientsApi.lookupByPhone(phone);
      if (res.data) {
        setDuplicateClient(res.data);
        return;
      }
      await submitFlow();
    } catch {
      // lookup — best-effort; при сбое идём создавать.
      await submitFlow();
    } finally {
      setSubmitting(false);
    }
  };

  // «Выбрать в чек» для дубликата клиента: подставляем клиента, а если у
  // него уже есть авто с введённым номером — сразу и его.
  const handleSelectExistingClient = () => {
    if (!duplicateClient) return;
    const q = normalizePlateForSearch(plate, plateMode);
    const matchingCar =
      q.length > 0
        ? duplicateClient.cars?.find((c) => normalizePlateForSearch(c.plateNumber || '', plateMode).includes(q))
        : undefined;
    const clientId = duplicateClient.id;
    const carId = matchingCar?.id;
    setDuplicateClient(null);
    onSelectExisting(clientId, carId);
  };

  const handleCreateClientAnyway = () => {
    setDuplicateClient(null);
    void submitFlow();
  };

  // Дубликат авто: номер уже привязан → подставляем владельца и эту машину.
  const handleSelectCarOwner = () => {
    if (!duplicateCar) return;
    const ownerId = duplicateCar.clientId;
    const carId = duplicateCar.id;
    setDuplicateCar(null);
    if (ownerId) {
      onSelectExisting(ownerId, carId);
    }
    // Машина без владельца — просто закрываем предупреждение, пусть
    // пользователь поправит номер или создаст «всё равно».
  };

  const handleCreateCarAnyway = () => {
    setDuplicateCar(null);
    void submitFlow({ forceCar: true });
  };

  return (
    <>
      <BottomSheet visible={visible} onClose={onClose} title="Новый клиент" heightRatio={0.88}>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>ФИО *</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Введите ФИО клиента"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>

        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Телефон *</Text>
          <TextInput
            value={phone}
            onChangeText={(t) => setPhone(formatPhone(t.replace(/\D/g, '')))}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="+7 (___) ___-__-__"
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>

        <View style={styles.formField}>
          <View style={styles.plateLabelRow}>
            <Text style={[styles.formLabel, { color: palette.text.secondary, marginBottom: 0 }]}>Госномер</Text>
            <PlateModeSwitcher value={plateMode} onChange={setPlateMode} />
          </View>
          <RussianPlateInput value={plate} onChangeText={setPlate} mode={plateMode} autoFocus={false} />
        </View>

        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Марка и модель</Text>
          <TextInput
            value={makeModel}
            onChangeText={setMakeModel}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Lada Priora"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>

        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity style={[styles.cancelBtn, { borderColor: palette.border.strong }]} onPress={onClose}>
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <View style={styles.submitInner}>
                <Ionicons name="person-add-outline" size={16} color={colors.white} />
                <Text style={styles.submitBtnText}>Создать</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Дубликат по телефону — как в ClientsScreen, но «открыть» = выбрать в чек. */}
      <DuplicateWarningDialog
        visible={!!duplicateClient}
        onClose={() => setDuplicateClient(null)}
        onCreateAnyway={handleCreateClientAnyway}
        onOpenExisting={handleSelectExistingClient}
        title="Такой клиент уже есть"
        description="Клиент с этим телефоном уже существует. Выбрать существующего в чек или всё равно создать?"
        existingLabel={duplicateClient?.fullName || ''}
        existingSubtitle={duplicateClient?.phone ? formatPhone(duplicateClient.phone) : undefined}
        existingCars={duplicateClient?.cars}
        openExistingLabel="Выбрать в чек"
      />

      {/* Дубликат по номеру — выбираем владельца машины прямо в чек. */}
      <DuplicateWarningDialog
        visible={!!duplicateCar}
        onClose={() => setDuplicateCar(null)}
        onCreateAnyway={handleCreateCarAnyway}
        onOpenExisting={handleSelectCarOwner}
        title="Такой автомобиль уже есть"
        description={
          duplicateCar?.client
            ? `Госномер ${duplicateCar.plateNumber} уже привязан к клиенту.`
            : `Госномер ${duplicateCar?.plateNumber || ''} уже существует.`
        }
        existingLabel={duplicateCar?.makeModel || duplicateCar?.plateNumber || ''}
        existingSubtitle={duplicateCar?.client ? `Клиент: ${duplicateCar.client.fullName}` : duplicateCar?.plateNumber}
        openExistingLabel={duplicateCar?.client ? 'Выбрать в чек' : 'Закрыть'}
      />
    </>
  );
}

const styles = StyleSheet.create({
  formField: { marginBottom: spacing[3] },
  formLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
    marginBottom: spacing[1.5],
  },
  formInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  plateLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[1.5],
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingTop: spacing[3],
    marginTop: spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  submitBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitInner: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
});
