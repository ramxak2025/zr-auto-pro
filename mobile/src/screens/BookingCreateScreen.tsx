/**
 * BookingCreateScreen — «+ Новая запись».
 *
 * Поток (по docs/ONLINE_BOOKING_DESIGN.md §3):
 *   1. Клиент — поиск по госномеру/телефону (тот же приём, что в Кассе:
 *      clientsApi.getAll({ search }) + RussianPlateInput + PlateModeSwitcher),
 *      не нашли → QuickClientCreateSheet («добавить нового»). Опц. выбор авто.
 *   2. Мастер — по умолчанию текущий пользователь, если он мастер; админ/
 *      владелец может выбрать любого мастера ИЛИ «без мастера».
 *   3. Дата+время — кроссплатформенный DateTimePickerModal (нативный iOS
 *      календарь/барабаны, перекрашенный JS-фоллбек на Android).
 *   4. Комментарий — свободный текст (услуги/товары НЕ выбираем).
 *   5. Сохранить → bookingsApi.create. Если ответ содержит conflictWarning —
 *      мягкая (не блокирующая) подсказка «⚠️ у мастера уже есть запись».
 *
 * Android-safe: никаких iOS-only API; пикер кроссплатформенный.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import RussianPlateInput from '../components/RussianPlateInput';
import PlateModeSwitcher, { type PlateMode } from '../components/PlateModeSwitcher';
import QuickClientCreateSheet from '../components/QuickClientCreateSheet';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { clientsApi, usersApi, bookingsApi } from '../api/services';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { normalizePlateForSearch } from '../utils/plateMask';
import { haptic } from '../platform/haptics';
import { iosSectionLabel } from '../platform/iosSurface';
import { colors, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { UserRole, type Client, type Car, type User } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';
import { formatBookingDay, formatBookingTime } from './bookings/bookingHelpers';

export default function BookingCreateScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { user, isRole } = useAuth();

  const isOwnerClass = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN);

  // ── Client / car selection ───────────────────────────────────────────────
  const [clientId, setClientId] = useState('');
  const [carId, setCarId] = useState('');
  const [plateSearch, setPlateSearch] = useState('');
  const [plateMode, setPlateMode] = useState<PlateMode>('ru');
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  // ── Master ────────────────────────────────────────────────────────────────
  // Мастер по умолчанию — текущий пользователь, если он мастер. Админ/владелец
  // стартует с «без мастера» (null), и может выбрать любого или оставить так.
  const selfIsMaster = user?.role === 'master';
  const [masterId, setMasterId] = useState<string | null>(selfIsMaster ? (user?.id ?? null) : null);
  const [showMasterPicker, setShowMasterPicker] = useState(false);

  // ── Date / time ─────────────────────────────────────────────────────────
  // Старт: следующий «круглый» час (минуты обнулены), чтобы не предлагать
  // запись на «сейчас + случайные минуты».
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  // ── Comment ────────────────────────────────────────────────────────────
  const [comment, setComment] = useState('');

  // ── Conflict warning (мягкая, не блокирует) ──────────────────────────────
  // Запись УЖЕ сохранена; conflictNote — текст «у мастера уже есть запись».
  // savedConflict переводит экран в состояние «сохранено, прочитай и закрой»,
  // чтобы предупреждение не пролетело мимо при мгновенном возврате назад.
  const [conflictNote, setConflictNote] = useState<string | null>(null);
  const [savedConflict, setSavedConflict] = useState(false);

  // ── Client search (зеркало приёма Кассы) ─────────────────────────────────
  const normalizedSearch = useMemo(() => normalizePlateForSearch(plateSearch, plateMode), [plateSearch, plateMode]);
  const debouncedPlate = useDebouncedValue(plateSearch, 300);
  const debouncedNormalized = useMemo(
    () => normalizePlateForSearch(debouncedPlate, plateMode),
    [debouncedPlate, plateMode],
  );
  const { data: searchResults, isFetching: isFetchingSearch } = useQuery<Client[]>({
    queryKey: ['clients-plate', debouncedNormalized, plateMode],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search: debouncedNormalized, limit: 20 });
      return res.data.data || [];
    },
    enabled: debouncedNormalized.length >= 2,
    placeholderData: (prev) => prev,
  });

  // Selected client detail (для имени/телефона/списка авто). Засевается из
  // выбранного объекта при тапе (см. ниже), поэтому к моменту enabled здесь
  // уже лежит готовая карточка — getById только дотягивает свежий список авто.
  const { data: clientData } = useQuery<Client>({
    queryKey: ['client-detail', clientId],
    queryFn: async () => (await clientsApi.getById(clientId)).data,
    enabled: !!clientId,
  });

  // Flatten поиск в плоский список «клиент + авто» как в Кассе.
  const plateResults = useMemo(() => {
    const out: Array<{ client: Client; car: Car }> = [];
    for (const client of searchResults || []) {
      for (const car of client.cars || []) {
        out.push({ client, car });
      }
    }
    return out;
  }, [searchResults]);

  // Выбранный клиент. Как в Кассе (CheckCreateScreen): пока getById в пути,
  // берём объект из текущего поиска, чтобы карточка появилась МГНОВЕННО и не
  // «пропадала» (не откатывалась к полю поиска). После прихода свежих данных
  // clientData их заменяет.
  const selectedClient = clientData ?? searchResults?.find((c) => c.id === clientId);
  const clientCars = selectedClient?.cars;
  const selectedCar = clientCars?.find((c) => c.id === carId);

  // Засеять кеш ['client-detail', id] выбранным объектом → карточка рисуется
  // в этом же кадре, без сетевого ожидания и без мигания обратно на поиск.
  const seedClientDetail = (client: Client, car: Car | null) => {
    queryClient.setQueryData<Client>(['client-detail', client.id], {
      ...client,
      cars: car ? [car, ...(client.cars || []).filter((c) => c.id !== car.id)] : client.cars || [],
    });
  };

  // ── Masters ────────────────────────────────────────────────────────────
  const { data: allUsers } = useQuery<User[]>({
    queryKey: ['all-users'],
    queryFn: async () => (await usersApi.getAll()).data,
  });
  // Только активные мастера (как везде в кассе/графике). Владельцы/админы не
  // «мастера» — на запись назначают того, кто реально выполняет работу.
  const masters = useMemo(
    () => (allUsers || []).filter((u) => u.isActive && !u.hiddenEverywhere && u.role === 'master'),
    [allUsers],
  );
  const selectedMaster = masters.find((m) => m.id === masterId);

  // Имя мастера в кнопке-селекторе. Если текущий выбран, но ещё не в кэше
  // (master сам себе), показываем имя из auth.
  const masterButtonLabel = (() => {
    if (!masterId) return 'Без мастера';
    if (selectedMaster) return selectedMaster.fullName;
    if (masterId === user?.id) return user?.fullName || 'Я';
    return 'Мастер';
  })();

  // ── Create ────────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: () =>
      bookingsApi.create({
        clientId,
        carId: carId || null,
        masterId: masterId,
        scheduledAt: scheduledAt.toISOString(),
        comment: comment.trim() || undefined,
      }),
    onSuccess: async (res) => {
      const result = res.data;
      // Инвалидация списка обеих вкладок (новая запись — в Предстоящих).
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      if (result.conflictWarning) {
        // Сохранение УЖЕ прошло — это НЕ блокирующее предупреждение. Не
        // улетаем назад мгновенно: показываем заметку и переводим кнопку в
        // «Готово», чтобы владелец прочитал, что у мастера уже есть запись.
        const t = formatBookingTime(result.conflictWarning.scheduledAt);
        haptic('warning');
        setConflictNote(`У мастера уже есть запись на ${t}. Запись всё равно создана.`);
        setSavedConflict(true);
      } else {
        // Чистое сохранение — мгновенный возврат к списку.
        haptic('success');
        navigation.goBack();
      }
    },
    onError: () => {
      haptic('error');
      setConflictNote(null);
      Alert.alert('Не удалось создать запись', 'Проверьте подключение и попробуйте ещё раз.');
    },
  });

  // Если клиента не выбрали, кнопка «Сохранить» неактивна (запись без клиента
  // запрещена контрактом). Дату в прошлом разрешаем (владелец может заносить
  // «задним числом»), сервер сам разберётся со scope.
  const canSave = !!clientId && !createMutation.isPending;

  const handleSave = () => {
    // После сохранения с конфликтом кнопка работает как «Готово».
    if (savedConflict) {
      haptic('tap');
      navigation.goBack();
      return;
    }
    if (!clientId) {
      haptic('warning');
      return;
    }
    haptic('tap');
    createMutation.mutate();
  };

  // QuickClientCreate колбэки — подставляем созданного/выбранного клиента.
  const handleClientCreated = (client: Client, car: Car | null) => {
    setShowQuickCreate(false);
    // Засеваем кеш карточки → selected-card мгновенно (как в Кассе).
    seedClientDetail(client, car);
    setClientId(client.id);
    setCarId(car?.id || '');
    setPlateSearch('');
  };
  const handleClientSelectedExisting = (id: string, existingCarId?: string) => {
    setShowQuickCreate(false);
    setClientId(id);
    setCarId(existingCarId || '');
    setPlateSearch('');
  };

  const clearClient = () => {
    haptic('tap');
    setClientId('');
    setCarId('');
    setPlateSearch('');
  };

  // До сохранения держим заметку пустой; после сохранения-с-конфликтом она
  // закреплена (savedConflict), и менять поля уже не нужно.
  useEffect(() => {
    if (!savedConflict) setConflictNote(null);
  }, [masterId, scheduledAt, savedConflict]);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Новая запись" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[8] }]}
          keyboardShouldPersistTaps="handled"
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
        >
          {/* ═══ КЛИЕНТ ═══ */}
          <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>КЛИЕНТ</Text>

          {clientId && selectedClient ? (
            <View
              style={[styles.selectedCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <View style={styles.selectedTop}>
                <View style={styles.selectedAvatar}>
                  <Ionicons name="person" size={20} color={colors.primary[700]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.selectedName, { color: palette.text.primary }]} numberOfLines={1}>
                    {selectedClient.fullName}
                  </Text>
                  {!!selectedClient.phone && (
                    <Text style={[styles.selectedPhone, { color: palette.text.tertiary }]} numberOfLines={1}>
                      {formatPhone(selectedClient.phone)}
                    </Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={clearClient}
                  hitSlop={10}
                  style={[styles.clearBtn, { backgroundColor: palette.bg.muted }]}
                  accessibilityLabel="Сбросить клиента"
                >
                  <Ionicons name="close" size={18} color={palette.text.secondary} />
                </TouchableOpacity>
              </View>

              {/* Авто клиента — выбор, если есть несколько. */}
              {clientCars && clientCars.length > 0 && (
                <View style={[styles.carRow, { borderTopColor: palette.border.subtle }]}>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carChips}>
                    {/* «Без авто» опция. */}
                    <CarChip label="Без авто" active={!carId} onPress={() => setCarId('')} palette={palette} />
                    {clientCars.map((car) => (
                      <CarChip
                        key={car.id}
                        label={car.plateNumber || car.makeModel || 'Авто'}
                        sub={car.plateNumber ? car.makeModel : undefined}
                        active={carId === car.id}
                        onPress={() => setCarId(car.id)}
                        palette={palette}
                      />
                    ))}
                  </ScrollView>
                </View>
              )}
              {selectedCar?.makeModel ? (
                <Text style={[styles.carHint, { color: palette.text.tertiary }]} numberOfLines={1}>
                  {selectedCar.makeModel}
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={[styles.searchCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              <View style={styles.plateLabelRow}>
                <Text style={[styles.subLabel, { color: palette.text.secondary }]}>ПОИСК ПО ГОСНОМЕРУ</Text>
                <PlateModeSwitcher value={plateMode} onChange={setPlateMode} />
              </View>
              <RussianPlateInput value={plateSearch} onChangeText={setPlateSearch} autoFocus={false} mode={plateMode} />

              {normalizedSearch.length >= 2 && plateResults.length > 0 && (
                <View style={[styles.results, { borderColor: palette.border.subtle }]}>
                  {plateResults.slice(0, 6).map(({ client, car }) => (
                    <TouchableOpacity
                      key={`${client.id}-${car.id}`}
                      style={[styles.resultItem, { borderBottomColor: palette.border.subtle }]}
                      onPress={() => {
                        haptic('select');
                        // Сидируем карточку выбранного клиента в кеш ДО смены
                        // clientId — selected-card покажется в этом же кадре,
                        // getById ниже только дотянет полный список авто.
                        seedClientDetail(client, car);
                        setClientId(client.id);
                        setCarId(car.id);
                        setPlateSearch('');
                      }}
                      activeOpacity={0.7}
                    >
                      {car.plateNumber ? (
                        <View style={styles.resultPlate}>
                          <Text style={styles.resultPlateText}>{car.plateNumber}</Text>
                        </View>
                      ) : null}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.resultName, { color: palette.text.primary }]} numberOfLines={1}>
                          {car.makeModel || client.fullName}
                        </Text>
                        <Text style={[styles.resultSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                          {client.fullName}
                          {client.phone ? ` · ${formatPhone(client.phone)}` : ''}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {normalizedSearch.length >= 2 &&
                plateResults.length === 0 &&
                debouncedNormalized === normalizedSearch &&
                !isFetchingSearch && (
                  <View style={styles.notFound}>
                    <Text style={[styles.notFoundText, { color: palette.text.tertiary }]}>Клиент не найден</Text>
                    <TouchableOpacity
                      style={[
                        styles.createClientBtn,
                        { backgroundColor: colors.primary[50], borderColor: colors.primary[100] },
                      ]}
                      onPress={() => setShowQuickCreate(true)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="person-add-outline" size={15} color={colors.primary[600]} />
                      <Text style={styles.createClientBtnText}>Создать клиента</Text>
                    </TouchableOpacity>
                  </View>
                )}

              {/* Всегда доступная кнопка «новый клиент» — даже без ввода. */}
              {normalizedSearch.length < 2 && (
                <TouchableOpacity
                  style={[styles.addClientInline, { borderColor: palette.border.subtle }]}
                  onPress={() => setShowQuickCreate(true)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="person-add-outline" size={16} color={colors.primary[600]} />
                  <Text style={[styles.addClientInlineText, { color: palette.text.primary }]}>
                    Добавить нового клиента
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* ═══ МАСТЕР ═══ */}
          <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>МАСТЕР</Text>
          <TouchableOpacity
            style={[styles.fieldRow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={() => {
              // Мастер выбирает только себя (сервер всё равно проставит self),
              // поэтому пикер открываем только для админ/владельца.
              if (!isOwnerClass) return;
              haptic('tap');
              setShowMasterPicker((v) => !v);
            }}
            activeOpacity={isOwnerClass ? 0.7 : 1}
          >
            <Ionicons name="person-circle-outline" size={20} color={palette.text.secondary} />
            <Text
              style={[styles.fieldValue, { color: masterId ? palette.text.primary : palette.text.tertiary }]}
              numberOfLines={1}
            >
              {masterButtonLabel}
            </Text>
            {isOwnerClass ? (
              <Ionicons
                name={showMasterPicker ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={palette.text.tertiary}
              />
            ) : (
              <View style={styles.selfBadge}>
                <Text style={styles.selfBadgeText}>ВЫ</Text>
              </View>
            )}
          </TouchableOpacity>

          {isOwnerClass && showMasterPicker && (
            <View
              style={[styles.masterPicker, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              {/* «Без мастера» — общая запись. */}
              <MasterOption
                label="Без мастера"
                hint="Общая запись (назначите позже)"
                active={!masterId}
                onPress={() => {
                  haptic('select');
                  setMasterId(null);
                  setShowMasterPicker(false);
                }}
                palette={palette}
              />
              {masters.map((m) => (
                <MasterOption
                  key={m.id}
                  label={m.fullName}
                  active={masterId === m.id}
                  onPress={() => {
                    haptic('select');
                    setMasterId(m.id);
                    setShowMasterPicker(false);
                  }}
                  palette={palette}
                />
              ))}
              {masters.length === 0 && (
                <Text style={[styles.masterEmpty, { color: palette.text.tertiary }]}>Нет активных мастеров</Text>
              )}
            </View>
          )}

          {/* ═══ ДАТА И ВРЕМЯ ═══ */}
          <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>ДАТА И ВРЕМЯ</Text>
          <View style={styles.dateTimeRow}>
            <TouchableOpacity
              style={[styles.dateTimeBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => {
                haptic('tap');
                setShowDatePicker(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="calendar-outline" size={18} color={colors.primary[600]} />
              <Text style={[styles.dateTimeText, { color: palette.text.primary }]} numberOfLines={1}>
                {formatBookingDay(scheduledAt.toISOString())}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dateTimeBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => {
                haptic('tap');
                setShowTimePicker(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="time-outline" size={18} color={colors.primary[600]} />
              <Text style={[styles.dateTimeText, { color: palette.text.primary }]}>
                {formatBookingTime(scheduledAt.toISOString())}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ═══ КОММЕНТАРИЙ ═══ */}
          <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>КОММЕНТАРИЙ</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            style={[
              styles.commentInput,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Например: установка ГБО, ТО, диагностика…"
            placeholderTextColor={palette.text.tertiary}
            multiline
          />

          {conflictNote ? (
            <View style={[styles.conflictNote, { backgroundColor: colors.amber[50], borderColor: colors.amber[200] }]}>
              <Ionicons name="warning-outline" size={16} color={colors.amber[700]} />
              <Text style={styles.conflictNoteText}>{conflictNote}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* ── Sticky save bar ── */}
        <View
          style={[
            styles.saveBar,
            {
              backgroundColor: palette.bg.card,
              borderTopColor: palette.border.subtle,
              // Поднять липкую панель «Сохранить» НАД плавающим таб-баром, иначе
              // кнопка уезжает под него (tabBarHeight уже учитывает home-indicator).
              marginBottom: tabBarHeight,
            },
          ]}
        >
          {(() => {
            // Три состояния: после сохранения-с-конфликтом — «Готово» (зелёная),
            // обычное активное — «Сохранить запись», неактивное — «Выберите клиента».
            const enabled = savedConflict || canSave;
            const bg = savedConflict ? colors.green[600] : canSave ? colors.primary[600] : palette.bg.muted;
            const fg = enabled ? colors.white : palette.text.tertiary;
            const label = savedConflict ? 'Готово' : clientId ? 'Сохранить запись' : 'Выберите клиента';
            return (
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: bg }]}
                onPress={handleSave}
                disabled={!enabled}
                activeOpacity={0.85}
              >
                {createMutation.isPending ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={18} color={fg} />
                    <Text style={[styles.saveBtnText, { color: fg }]}>{label}</Text>
                  </>
                )}
              </TouchableOpacity>
            );
          })()}
        </View>
      </KeyboardAvoidingView>

      {/* ── Date / time pickers ── */}
      <DateTimePickerModal
        visible={showDatePicker}
        value={scheduledAt}
        mode="date"
        onConfirm={(d) => {
          // Сохраняем время, меняем только дату.
          const next = new Date(scheduledAt);
          next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
          setScheduledAt(next);
          setShowDatePicker(false);
        }}
        onCancel={() => setShowDatePicker(false)}
      />
      <DateTimePickerModal
        visible={showTimePicker}
        value={scheduledAt}
        mode="time"
        onConfirm={(d) => {
          const next = new Date(scheduledAt);
          next.setHours(d.getHours(), d.getMinutes(), 0, 0);
          setScheduledAt(next);
          setShowTimePicker(false);
        }}
        onCancel={() => setShowTimePicker(false)}
      />

      {/* ── Quick client create (переиспользуем из Кассы) ── */}
      <QuickClientCreateSheet
        visible={showQuickCreate}
        onClose={() => setShowQuickCreate(false)}
        initialPlate={plateSearch}
        initialPlateMode={plateMode}
        onCreated={handleClientCreated}
        onSelectExisting={handleClientSelectedExisting}
      />
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────
function CarChip({
  label,
  sub,
  active,
  onPress,
  palette,
}: {
  label: string;
  sub?: string;
  active: boolean;
  onPress: () => void;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[
        styles.carChip,
        {
          backgroundColor: active ? colors.primary[600] : palette.bg.muted,
          borderColor: active ? colors.primary[600] : palette.border.subtle,
        },
      ]}
    >
      <Text style={[styles.carChipLabel, { color: active ? colors.white : palette.text.primary }]} numberOfLines={1}>
        {label}
      </Text>
      {sub ? (
        <Text
          style={[styles.carChipSub, { color: active ? 'rgba(255,255,255,0.85)' : palette.text.tertiary }]}
          numberOfLines={1}
        >
          {sub}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

function MasterOption({
  label,
  hint,
  active,
  onPress,
  palette,
}: {
  label: string;
  hint?: string;
  active: boolean;
  onPress: () => void;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[styles.masterOption, { borderBottomColor: palette.border.subtle }]}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.masterOptionLabel, { color: palette.text.primary }]} numberOfLines={1}>
          {label}
        </Text>
        {hint ? (
          <Text style={[styles.masterOptionHint, { color: palette.text.tertiary }]} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      {active ? <Ionicons name="checkmark-circle" size={20} color={colors.primary[600]} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },

  sectionLabel: { marginLeft: spacing[1], marginTop: spacing[4], marginBottom: spacing[2] },

  // Selected client card
  selectedCard: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[3.5],
    gap: spacing[2.5],
  },
  selectedTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  selectedAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedName: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  selectedPhone: { fontSize: 13, marginTop: 1 },
  clearBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  carRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing[2.5] },
  carChips: { gap: spacing[2], paddingRight: spacing[2] },
  carChip: {
    minWidth: 70,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  carChipLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },
  carChipSub: { fontSize: 10, marginTop: 1, maxWidth: 120 },
  carHint: { fontSize: 12 },

  // Search card
  searchCard: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[3.5],
  },
  plateLabelRow: {
    // Лейбл сверху, переключатель RU/INT под ним и прижат влево (alignSelf:
    // 'flex-start' у самого свитчера) — раньше был space-between, и свитчер
    // уезжал к правому краю и смотрелся криво.
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing[2],
    marginBottom: spacing[2.5],
  },
  subLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  results: {
    marginTop: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultPlate: {
    backgroundColor: colors.gray[900],
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  resultPlateText: { color: colors.white, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  resultName: { fontSize: 14, fontWeight: '600', letterSpacing: -0.1 },
  resultSub: { fontSize: 12, marginTop: 1 },
  notFound: { marginTop: spacing[3], alignItems: 'center', gap: spacing[2.5] },
  notFoundText: { fontSize: 13 },
  createClientBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  createClientBtnText: { fontSize: 13, fontWeight: '600', color: colors.primary[600] },
  addClientInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  addClientInlineText: { fontSize: 14, fontWeight: '600' },

  // Field rows
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldValue: { flex: 1, fontSize: 15, fontWeight: '600' },
  selfBadge: {
    backgroundColor: colors.green[50],
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  selfBadgeText: { fontSize: 9, fontWeight: '700', color: colors.green[700], letterSpacing: 0.4 },

  masterPicker: {
    marginTop: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  masterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  masterOptionLabel: { fontSize: 15, fontWeight: '600' },
  masterOptionHint: { fontSize: 12, marginTop: 1 },
  masterEmpty: { fontSize: 13, padding: spacing[3.5], textAlign: 'center' },

  // Date / time
  dateTimeRow: { flexDirection: 'row', gap: spacing[3] },
  dateTimeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dateTimeText: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },

  // Comment
  commentInput: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[3.5],
    minHeight: 90,
    fontSize: 15,
    textAlignVertical: 'top',
  },

  conflictNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  conflictNoteText: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.amber[800] },

  // Save bar
  saveBar: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
});
