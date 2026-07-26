/**
 * QuickClientCreateSheet — быстрое создание клиента прямо из Кассы.
 *
 * Открывается из состояния «Клиент не найден» поиска, чтобы касса не
 * превращалась в тупик: имя + телефон + (предзаполненный из поиска) госномер +
 * марка/модель — и клиент с авто сразу подставляются в чек.
 *
 * Поток:
 *   1. (опц.) `carsApi.lookupByPlate` — дубликат по номеру → DuplicateWarningDialog;
 *   2. `clientsApi.create`, затем `carsApi.create` с clientId из ответа
 *      (двухшаговый — CreateClientRequest не принимает машину inline).
 *
 * Дубликат по ТЕЛЕФОНУ ловит сам бэкенд: `POST /clients` возвращает 409
 * `{ code:'CLIENT_PHONE_EXISTS', clientId, client }` (нормализация номера — та
 * же last-10, что и в поиске). Реакция зависит от того, ввёл ли пользователь
 * авто:
 *   • ввёл госномер/марку → «Клиент уже есть … Добавить автомобиль X к нему?»,
 *     по «Да» привязываем машину к существующему клиенту (carsApi.create, или
 *     переиспользуем найденную по номеру) и через onSelectExisting(clientId,
 *     carId) подставляем пару в текущий чек — поток кассы не упирается в тупик;
 *   • авто не вводил → «Клиент уже добавлен» + «Перейти к клиенту»
 *     (onSelectExisting(clientId)).
 * «Всё равно создать» для телефона нет — бэкенд дубликат по номеру не создаёт.
 * Пустое имя → дружелюбный 400.
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
  /** Предзаполнение из поиска по ТЕЛЕФОНУ (Round 7 #8) — как набрано в Кассе.
   *  Пустая строка / undefined → поведение байт-в-байт прежнее. */
  initialPhone?: string;
  /** Клиент (и опционально авто) созданы — родитель подставляет их в чек. */
  onCreated: (client: Client, car: Car | null) => void;
  /** Найден существующий клиент/владелец — родитель подставляет его в чек. */
  onSelectExisting: (clientId: string, carId?: string) => void;
}

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
  initialPhone,
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

  const [duplicateCar, setDuplicateCar] = useState<DuplicateCar | null>(null);

  // Каждое открытие — чистая форма с номером из поиска (в текущем режиме
  // RU/INT), чтобы не перенабирать то, что уже введено в Кассе. Из поиска по
  // ТЕЛЕФОНУ (Round 7 #8) предзаполняется телефон: маска +7 применяется только
  // когда набранное похоже на НАЧАЛО номера (7/8 — как есть, 9… — национальный
  // без транка, дописываем 7). Короткий фрагмент («4485») оставляем цифрами —
  // formatPhone принял бы первую цифру за код страны и исказил бы номер.
  useEffect(() => {
    if (!visible) return;
    setFullName('');
    const seedDigits = (initialPhone || '').replace(/\D/g, '');
    if (seedDigits.startsWith('7') || seedDigits.startsWith('8')) {
      setPhone(formatPhone(seedDigits));
    } else if (seedDigits.startsWith('9')) {
      setPhone(formatPhone('7' + seedDigits));
    } else {
      setPhone(seedDigits);
    }
    setMakeModel('');
    setPlate(initialPlate);
    setPlateMode(initialPlateMode);
    setDuplicateCar(null);
    setSubmitting(false);
  }, [visible, initialPlate, initialPlateMode, initialPhone]);

  /** 409 по ТЕЛЕФОНУ, но пользователь ввёл авто: вместо тупика «просто перейти
   *  к клиенту» привязываем машину к УЖЕ существующему клиенту и сразу
   *  подставляем клиента+авто в текущий чек (с госномером). Если такой номер уже
   *  заведён у этого же клиента — переиспользуем существующую машину, а не
   *  плодим дубликат. */
  const attachCarToExisting = async (existingClientId: string, cleanPlate: string) => {
    setSubmitting(true);
    try {
      // Номер мог быть уже заведён у этого клиента — тогда берём его машину.
      if (cleanPlate.length > 0) {
        try {
          const found = await carsApi.lookupByPlate(cleanPlate);
          if (found.data && found.data.clientId === existingClientId) {
            haptic('success');
            onSelectExisting(existingClientId, found.data.id);
            return;
          }
        } catch {
          // best-effort — при сбое проверки создаём машину ниже.
        }
      }
      const carRes = await carsApi.create({
        plateNumber: cleanPlate,
        makeModel: makeModel.trim(),
        clientId: existingClientId,
      });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      queryClient.invalidateQueries({ queryKey: ['clients-plate'] });
      queryClient.invalidateQueries({ queryKey: ['cars-plate'] });
      haptic('success');
      onSelectExisting(existingClientId, carRes.data.id);
    } catch (e: any) {
      const d = e?.response?.data;
      const friendly =
        (d && typeof d.message === 'string' && d.message) ||
        (d && typeof d.error === 'string' && d.error) ||
        'Не удалось добавить автомобиль к клиенту';
      Alert.alert('Ошибка', String(friendly));
    } finally {
      setSubmitting(false);
    }
  };

  /** Создание: (опц. проверка дубля по номеру) → клиент → авто.
   *  Дубликат по ТЕЛЕФОНУ возвращает сам бэкенд (409) — ловим в catch. */
  const submitFlow = async (opts?: { forceCar?: boolean }) => {
    const cleanPlate = plate.trim();
    setSubmitting(true);
    try {
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
      queryClient.invalidateQueries({ queryKey: ['cars-plate'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      haptic('success');
      onCreated(clientRes.data, car);
    } catch (err: any) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      // 409 — клиент с этим телефоном уже есть. Бэкенд дубликат по номеру не
      // создаёт, поэтому предлагаем перейти к существующему клиенту.
      if (status === 409 && data?.code === 'CLIENT_PHONE_EXISTS' && data?.clientId) {
        const existingId = String(data.clientId);
        const existingName =
          (data?.client && typeof data.client.fullName === 'string' && data.client.fullName) || 'Клиент';
        const existingPhone = (data?.client && typeof data.client.phone === 'string' && data.client.phone) || '';
        // Пользователь ввёл авто → не тупик: предлагаем привязать этот
        // автомобиль к найденному клиенту и сразу подставить пару в чек.
        const hasCar = cleanPlate.length > 0 || makeModel.trim().length > 0;
        if (hasCar) {
          haptic('warning');
          const plateLabel = cleanPlate || makeModel.trim();
          Alert.alert(
            'Клиент уже есть',
            `${existingName} уже есть в базе${existingPhone ? ` (номер ${formatPhone(existingPhone)})` : ''}. ` +
              `Добавить автомобиль ${plateLabel} к нему?`,
            [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Да, добавить авто', onPress: () => void attachCarToExisting(existingId, cleanPlate) },
            ],
          );
          return;
        }
        // Авто не вводили → прежнее поведение: просто перейти к клиенту.
        haptic('warning');
        Alert.alert(
          'Клиент уже добавлен',
          typeof data?.message === 'string' ? data.message : 'Клиент с этим номером уже добавлен',
          [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Перейти к клиенту', onPress: () => onSelectExisting(existingId) },
          ],
        );
        return;
      }
      // Дружелюбный 400 (пустое имя) и любой другой сбой — показываем реальную
      // причину, а не глухое «Не удалось создать клиента».
      const friendly =
        (data && typeof data.message === 'string' && data.message) ||
        (data && typeof data.error === 'string' && data.error) ||
        (typeof data === 'string' ? data : '') ||
        'Не удалось создать клиента';
      Alert.alert('Ошибка', String(friendly));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = () => {
    if (!fullName.trim()) {
      Alert.alert('Ошибка', 'Укажите имя клиента');
      return;
    }
    if (!phone.trim()) {
      // Round 12 #3: клиент без телефона легален (backend коэрсит phone в ''
      // и частичный уникальный индекс пропускает пустой ключ), но пропущенный
      // номер чаще случайность — вместо жёсткого блока явный confirm.
      // Дальше идёт ОБЫЧНЫЙ submitFlow: дубликат-гарды по телефону (409) и
      // по госномеру срабатывают только при непустых значениях и не задеты.
      haptic('warning');
      Alert.alert('Создать клиента без номера телефона?', 'Его нельзя будет найти поиском по номеру.', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Без номера', onPress: () => void submitFlow() },
      ]);
      return;
    }
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
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Телефон</Text>
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
