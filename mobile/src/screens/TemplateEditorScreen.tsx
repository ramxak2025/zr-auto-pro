/**
 * TemplateEditorScreen — создание / правка шаблона чека (пушится из
 * TemplatesScreen; зарегистрирован и в MoreStack, и на корневом стеке —
 * для входа из Кассы через «Управлять»).
 *
 * Состав: название + строки УСЛУГ (поиск по каталогу, цена/кол-во правятся
 * в строке) + строки ТОВАРОВ (простой серверный поиск, кол-во в строке;
 * полноэкранный ProductPicker сюда сознательно НЕ интегрируем — редактор
 * самодостаточный и простой) + папка размещения.
 *
 * «Общий шаблон» — переключатель ТОЛЬКО при создании и ТОЛЬКО для
 * owner-class (director/admin/superadmin): у backend'а нет shared-флага в
 * update, публикация происходит в момент создания (user_id NULL). Общий
 * шаблон нельзя положить в личную папку (400) — выбор папки при включённом
 * переключателе скрывается. Мастер, открывший общий шаблон, видит режим
 * просмотра: без правок, сохранения и удаления (backend всё равно 403).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import Modal from '../components/Modal';
import { KeyboardAwareView } from '../components/KeyboardAware';
import { checkTemplatesApi, servicesApi, productsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint, getBadgeColors } from '../theme';
import { iosCard, useShadow } from '../platform/iosSurface';
import { haptic } from '../platform/haptics';
import { UserRole } from '../../../shared/types';
import type { CheckTemplate, CheckTemplateFolder, Service, Product } from '../../../shared/types';
import { FolderPickerList, isSharedTemplate, formatTemplateMoney } from './TemplatesScreen';

/** RU-дружественный парсер цены: запятая → точка, мусор → 0. */
function parsePrice(v: string): number {
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

interface EditorServiceLine {
  serviceId?: string;
  name: string;
  /** Строка, а не число — иначе TextInput дерётся с курсором при вводе. */
  priceText: string;
  quantity: number;
}

interface EditorProductLine {
  productId?: string;
  name: string;
  sellPrice: number;
  costPrice: number;
  quantity: number;
}

export default function TemplateEditorScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const isDark = palette.mode === 'dark';
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  const isOwnerClass = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN);

  const templateId: string | undefined = route.params?.templateId;
  const isEditing = !!templateId;

  const { data: templates = [], isLoading: templatesLoading } = useQuery<CheckTemplate[]>({
    queryKey: ['check-templates'],
    queryFn: async () => (await checkTemplatesApi.list()).data,
    staleTime: 60_000,
  });
  const { data: folders = [] } = useQuery<CheckTemplateFolder[]>({
    queryKey: ['check-template-folders'],
    queryFn: async () => (await checkTemplatesApi.folders.list()).data,
    staleTime: 60_000,
  });

  const template = useMemo(() => templates.find((t) => t.id === templateId), [templates, templateId]);
  const isSharedTpl = !!template && isSharedTemplate(template);
  // Мастер открыл общий шаблон → просмотр без правок (backend всё равно 403).
  const viewOnly = isEditing && isSharedTpl && !isOwnerClass;

  const [name, setName] = useState('');
  const [serviceLines, setServiceLines] = useState<EditorServiceLine[]>([]);
  const [productLines, setProductLines] = useState<EditorProductLine[]>([]);
  const [folderId, setFolderId] = useState<string | null>(route.params?.initialFolderId ?? null);
  const [shared, setShared] = useState(false); // только create + owner-class
  const [saving, setSaving] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  // Гидратация формы ОДИН раз на template — фоновая ревалидация списка не
  // должна перетирать правки (паттерн editCheck из CheckCreateScreen).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!isEditing || hydratedRef.current || !template) return;
    hydratedRef.current = true;
    setName(template.name);
    setServiceLines(
      (template.services || []).map((s) => ({
        serviceId: s.serviceId,
        name: s.name,
        priceText: String(s.price ?? 0),
        quantity: s.quantity || 1,
      })),
    );
    setProductLines(
      (template.products || []).map((p) => ({
        productId: p.productId,
        name: p.name,
        sellPrice: p.sellPrice ?? 0,
        costPrice: p.costPrice ?? 0,
        quantity: p.quantity || 1,
      })),
    );
    setFolderId(template.folderId ?? null);
  }, [isEditing, template]);

  // ── Пикеры состава ──────────────────────────────────────────────────────────

  const [showServicePicker, setShowServicePicker] = useState(false);
  const [serviceSearch, setServiceSearch] = useState('');
  const { data: allServices } = useQuery<Service[]>({
    queryKey: ['all-services'],
    queryFn: async () => {
      const res = await servicesApi.getAll({ limit: 500 });
      return res.data.data || res.data;
    },
    enabled: showServicePicker,
  });
  const filteredServices = useMemo(() => {
    const list = allServices || [];
    if (!serviceSearch.trim()) return list;
    const q = serviceSearch.trim().toLowerCase();
    return list.filter((s) => s.name.toLowerCase().includes(q));
  }, [allServices, serviceSearch]);

  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const debouncedProductSearch = useDebouncedValue(productSearch, 250);
  const { data: productResults } = useQuery<Product[]>({
    queryKey: ['template-product-search', debouncedProductSearch.trim()],
    queryFn: async () => {
      const res = await productsApi.getAll({ search: debouncedProductSearch.trim() || undefined, limit: 50 });
      return res.data.data || res.data;
    },
    enabled: showProductPicker,
  });

  const addService = (s: Service) => {
    haptic('tap');
    setServiceLines((lines) => {
      const idx = lines.findIndex((l) => l.serviceId === s.id);
      if (idx >= 0) {
        const next = [...lines];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [...lines, { serviceId: s.id, name: s.name, priceText: String(s.defaultPrice ?? 0), quantity: 1 }];
    });
  };

  const addProduct = (p: Product) => {
    haptic('tap');
    setProductLines((lines) => {
      const idx = lines.findIndex((l) => l.productId === p.id);
      if (idx >= 0) {
        const next = [...lines];
        next[idx] = { ...next[idx], quantity: next[idx].quantity + 1 };
        return next;
      }
      return [
        ...lines,
        { productId: p.id, name: p.name, sellPrice: p.sellPrice ?? 0, costPrice: p.costPrice ?? 0, quantity: 1 },
      ];
    });
  };

  const patchServiceLine = (idx: number, patch: Partial<EditorServiceLine>) =>
    setServiceLines((lines) => lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const patchProductLine = (idx: number, patch: Partial<EditorProductLine>) =>
    setProductLines((lines) => lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)));

  // ── Итоги ───────────────────────────────────────────────────────────────────

  const servicesTotal = useMemo(
    () => serviceLines.reduce((sum, l) => sum + parsePrice(l.priceText) * l.quantity, 0),
    [serviceLines],
  );
  const productsTotal = useMemo(
    () => productLines.reduce((sum, l) => sum + l.sellPrice * l.quantity, 0),
    [productLines],
  );
  const grandTotal = servicesTotal + productsTotal;

  // ── Сохранение / удаление ───────────────────────────────────────────────────

  const canSave = !viewOnly && !!name.trim() && serviceLines.length + productLines.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const services = serviceLines.map((l) => ({
        serviceId: l.serviceId,
        name: l.name,
        price: parsePrice(l.priceText),
        quantity: l.quantity,
      }));
      const products = productLines.map((l) => ({
        productId: l.productId,
        name: l.name,
        sellPrice: l.sellPrice,
        costPrice: l.costPrice,
        quantity: l.quantity,
      }));
      if (isEditing && templateId) {
        await checkTemplatesApi.update(templateId, {
          name: name.trim(),
          services,
          products,
          // Общий шаблон вне папок — folderId у него не трогаем вовсе.
          ...(isSharedTpl ? {} : { folderId }),
        });
      } else {
        await checkTemplatesApi.create({
          name: name.trim(),
          services,
          products,
          folderId: shared ? null : folderId,
          shared: shared || undefined,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['check-templates'] });
      haptic('success');
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось сохранить шаблон');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!templateId) return;
    Alert.alert('Удалить шаблон?', name || template?.name || '', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: async () => {
          try {
            await checkTemplatesApi.remove(templateId);
            queryClient.invalidateQueries({ queryKey: ['check-templates'] });
            haptic('success');
            navigation.goBack();
          } catch (err: any) {
            Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить шаблон');
          }
        },
      },
    ]);
  };

  // ── Подпись выбранной папки: «Родитель / Папка» ─────────────────────────────

  const folderLabel = useMemo(() => {
    if (!folderId) return 'Без папки';
    const byId = new Map(folders.map((f) => [f.id, f]));
    const parts: string[] = [];
    let cursor = byId.get(folderId);
    let guard = 0;
    while (cursor && guard < 10) {
      parts.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      guard += 1;
    }
    return parts.length > 0 ? parts.join(' / ') : 'Без папки';
  }, [folders, folderId]);

  const removeLine = useCallback((kind: 'service' | 'product', idx: number) => {
    haptic('tap');
    if (kind === 'service') setServiceLines((lines) => lines.filter((_, i) => i !== idx));
    else setProductLines((lines) => lines.filter((_, i) => i !== idx));
  }, []);

  // ── Рендер ──────────────────────────────────────────────────────────────────

  // Правка по прямой ссылке, пока список ещё грузится.
  if (isEditing && !template && templatesLoading) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Шаблон" onBack={() => navigation.goBack()} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.primary[500]} />
        </View>
      </View>
    );
  }
  if (isEditing && !template && !templatesLoading) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Шаблон" onBack={() => navigation.goBack()} />
        <View style={styles.centerFill}>
          <Text style={{ color: palette.text.secondary, fontSize: fontSize.sm }}>Шаблон не найден</Text>
        </View>
      </View>
    );
  }

  const cardStyle = [styles.card, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }];
  const inputStyle = [
    styles.input,
    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
  ];
  const sharedBadge = isDark ? getBadgeColors('dark').blue : { bg: colors.blue[50], text: colors.blue[600] };

  const stepper = (qty: number, onChange: (q: number) => void) => (
    <View style={[styles.stepper, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
      <TouchableOpacity
        hitSlop={8}
        style={styles.stepperBtn}
        onPress={() => {
          haptic('tap');
          onChange(Math.max(1, qty - 1));
        }}
      >
        <Ionicons name="remove" size={16} color={qty <= 1 ? palette.text.tertiary : colors.primary[500]} />
      </TouchableOpacity>
      <Text style={[styles.stepperQty, { color: palette.text.primary }]}>{qty}</Text>
      <TouchableOpacity
        hitSlop={8}
        style={styles.stepperBtn}
        onPress={() => {
          haptic('tap');
          onChange(qty + 1);
        }}
      >
        <Ionicons name="add" size={16} color={colors.primary[500]} />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={isEditing ? (viewOnly ? 'Просмотр шаблона' : 'Шаблон') : 'Новый шаблон'}
        subtitle={isSharedTpl ? 'Общий — виден всем сотрудникам' : undefined}
        onBack={() => navigation.goBack()}
      />
      {/* Клавиатура (миграция на keyboard-controller): KeyboardAwareView
          вместо RN-core KAV — offset из insets, одинаково iOS/Android. */}
      <KeyboardAwareView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[8] }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Название */}
          <View style={cardStyle}>
            <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Название</Text>
            {viewOnly ? (
              <Text style={[styles.nameStatic, { color: palette.text.primary }]}>{name}</Text>
            ) : (
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Например: ТО — замена масла"
                placeholderTextColor={palette.text.tertiary}
                style={inputStyle}
                returnKeyType="done"
              />
            )}
          </View>

          {/* Размещение: папка (личные) / признак «Общий» */}
          {!viewOnly && (
            <View style={cardStyle}>
              {!isEditing && isOwnerClass && (
                <View style={styles.sharedRow}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.sharedTitle, { color: palette.text.primary }]}>Общий шаблон</Text>
                    <Text style={[styles.sharedHint, { color: palette.text.tertiary }]}>
                      Виден всем сотрудникам, изменяет только руководитель
                    </Text>
                  </View>
                  <Switch
                    value={shared}
                    onValueChange={(v) => {
                      haptic('select');
                      setShared(v);
                    }}
                    trackColor={{ true: colors.primary[500] }}
                  />
                </View>
              )}
              {isEditing && isSharedTpl ? (
                <View style={styles.sharedRow}>
                  <View style={[styles.sharedStaticBadge, { backgroundColor: sharedBadge.bg }]}>
                    <Text style={[styles.sharedStaticBadgeText, { color: sharedBadge.text }]}>Общий шаблон</Text>
                  </View>
                  <Text style={[styles.sharedHint, { color: palette.text.tertiary, flex: 1 }]}>
                    Общие шаблоны живут вне личных папок
                  </Text>
                </View>
              ) : (
                !shared && (
                  <TouchableOpacity
                    style={[
                      styles.folderRow,
                      !isEditing && isOwnerClass && styles.folderRowDivider,
                      { borderTopColor: palette.border.subtle },
                    ]}
                    activeOpacity={0.6}
                    onPress={() => {
                      haptic('tap');
                      setShowFolderPicker(true);
                    }}
                  >
                    <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={[styles.fieldLabel, { color: palette.text.secondary, marginBottom: 0 }]}>Папка</Text>
                      <Text style={[styles.folderValue, { color: palette.text.primary }]} numberOfLines={1}>
                        {folderLabel}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                  </TouchableOpacity>
                )
              )}
            </View>
          )}

          {/* Услуги */}
          <View style={cardStyle}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <View
                  style={[
                    styles.sectionIcon,
                    { backgroundColor: isDark ? softTint(colors.orange[500], 'dark') : colors.orange[50] },
                  ]}
                >
                  <Ionicons name="build-outline" size={14} color={colors.orange[500]} />
                </View>
                <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Услуги</Text>
                {serviceLines.length > 0 && (
                  <Text style={[styles.sectionCount, { color: palette.text.tertiary }]}>{serviceLines.length}</Text>
                )}
              </View>
              {!viewOnly && (
                <TouchableOpacity
                  style={[
                    styles.addLineBtn,
                    { backgroundColor: isDark ? softTint(colors.primary[600], 'dark') : colors.primary[50] },
                  ]}
                  onPress={() => {
                    haptic('tap');
                    setServiceSearch('');
                    setShowServicePicker(true);
                  }}
                  hitSlop={6}
                >
                  <Ionicons name="add" size={16} color={isDark ? colors.primary[300] : colors.primary[600]} />
                </TouchableOpacity>
              )}
            </View>
            {serviceLines.length === 0 && (
              <Text style={[styles.emptyLines, { color: palette.text.tertiary }]}>
                {viewOnly ? 'Без услуг' : 'Добавьте услуги из каталога'}
              </Text>
            )}
            {serviceLines.map((line, idx) => (
              <View
                key={`${line.serviceId ?? line.name}-${idx}`}
                style={[styles.lineItem, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              >
                <View style={styles.lineTop}>
                  <Text style={[styles.lineName, { color: palette.text.primary }]} numberOfLines={2}>
                    {line.name}
                  </Text>
                  {!viewOnly && (
                    <TouchableOpacity hitSlop={10} onPress={() => removeLine('service', idx)}>
                      <Ionicons name="close" size={17} color={palette.text.tertiary} />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.lineControls}>
                  {viewOnly ? (
                    <Text style={[styles.lineStatic, { color: palette.text.secondary }]}>
                      {formatTemplateMoney(parsePrice(line.priceText))} × {line.quantity}
                    </Text>
                  ) : (
                    <>
                      <View
                        style={[
                          styles.priceInputWrap,
                          { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                        ]}
                      >
                        <TextInput
                          value={line.priceText}
                          onChangeText={(t) => patchServiceLine(idx, { priceText: t })}
                          keyboardType="decimal-pad"
                          style={[styles.priceInput, { color: palette.text.primary }]}
                          placeholder="0"
                          placeholderTextColor={palette.text.tertiary}
                        />
                        <Text style={[styles.priceCurrency, { color: palette.text.tertiary }]}>₽</Text>
                      </View>
                      {stepper(line.quantity, (q) => patchServiceLine(idx, { quantity: q }))}
                    </>
                  )}
                  <Text style={[styles.lineTotal, { color: palette.text.primary }]}>
                    {formatTemplateMoney(parsePrice(line.priceText) * line.quantity)}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Товары */}
          <View style={cardStyle}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionHeaderLeft}>
                <View
                  style={[
                    styles.sectionIcon,
                    { backgroundColor: isDark ? softTint(colors.blue[500], 'dark') : colors.blue[50] },
                  ]}
                >
                  <Ionicons name="cube-outline" size={14} color={colors.blue[500]} />
                </View>
                <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Товары</Text>
                {productLines.length > 0 && (
                  <Text style={[styles.sectionCount, { color: palette.text.tertiary }]}>{productLines.length}</Text>
                )}
              </View>
              {!viewOnly && (
                <TouchableOpacity
                  style={[
                    styles.addLineBtn,
                    { backgroundColor: isDark ? softTint(colors.primary[600], 'dark') : colors.primary[50] },
                  ]}
                  onPress={() => {
                    haptic('tap');
                    setProductSearch('');
                    setShowProductPicker(true);
                  }}
                  hitSlop={6}
                >
                  <Ionicons name="add" size={16} color={isDark ? colors.primary[300] : colors.primary[600]} />
                </TouchableOpacity>
              )}
            </View>
            {productLines.length === 0 && (
              <Text style={[styles.emptyLines, { color: palette.text.tertiary }]}>
                {viewOnly ? 'Без товаров' : 'Добавьте товары со склада'}
              </Text>
            )}
            {productLines.map((line, idx) => (
              <View
                key={`${line.productId ?? line.name}-${idx}`}
                style={[styles.lineItem, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              >
                <View style={styles.lineTop}>
                  <Text style={[styles.lineName, { color: palette.text.primary }]} numberOfLines={2}>
                    {line.name}
                  </Text>
                  {!viewOnly && (
                    <TouchableOpacity hitSlop={10} onPress={() => removeLine('product', idx)}>
                      <Ionicons name="close" size={17} color={palette.text.tertiary} />
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.lineControls}>
                  <Text style={[styles.lineStatic, { color: palette.text.secondary }]}>
                    {formatTemplateMoney(line.sellPrice)}
                    {viewOnly ? ` × ${line.quantity}` : ''}
                  </Text>
                  {!viewOnly && stepper(line.quantity, (q) => patchProductLine(idx, { quantity: q }))}
                  <Text style={[styles.lineTotal, { color: palette.text.primary }]}>
                    {formatTemplateMoney(line.sellPrice * line.quantity)}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Итого */}
          {(serviceLines.length > 0 || productLines.length > 0) && (
            <View style={cardStyle}>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: palette.text.secondary }]}>Услуги</Text>
                <Text style={[styles.totalValue, { color: palette.text.secondary }]}>
                  {formatTemplateMoney(servicesTotal)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: palette.text.secondary }]}>Товары</Text>
                <Text style={[styles.totalValue, { color: palette.text.secondary }]}>
                  {formatTemplateMoney(productsTotal)}
                </Text>
              </View>
              <View style={[styles.totalDivider, { backgroundColor: palette.border.subtle }]} />
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabelGrand, { color: palette.text.primary }]}>Итого</Text>
                <Text style={[styles.totalValueGrand, { color: palette.text.primary }]}>
                  {formatTemplateMoney(grandTotal)}
                </Text>
              </View>
            </View>
          )}

          {/* Сохранить / удалить */}
          {!viewOnly && (
            <>
              <TouchableOpacity
                style={[styles.saveBtn, { opacity: canSave ? 1 : 0.5 }]}
                disabled={!canSave}
                onPress={save}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>{isEditing ? 'Сохранить изменения' : 'Создать шаблон'}</Text>
                )}
              </TouchableOpacity>
              {isEditing && (
                <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete} activeOpacity={0.7}>
                  <Ionicons name="trash-outline" size={15} color={colors.red[500]} />
                  <Text style={styles.deleteBtnText}>Удалить шаблон</Text>
                </TouchableOpacity>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAwareView>

      {/* Выбор папки размещения */}
      <Modal visible={showFolderPicker} onClose={() => setShowFolderPicker(false)} title="Папка шаблона">
        <FolderPickerList
          folders={folders}
          selectedId={folderId}
          onSelect={(id) => {
            setFolderId(id);
            setShowFolderPicker(false);
          }}
        />
      </Modal>

      {/* Добавить услугу — остаётся открытым для мульти-добавления, в строке
          виден бейдж ×N уже добавленного. */}
      <Modal visible={showServicePicker} onClose={() => setShowServicePicker(false)} title="Добавить услугу">
        <View style={{ gap: spacing[3] }}>
          <TextInput
            value={serviceSearch}
            onChangeText={setServiceSearch}
            placeholder="Поиск услуги…"
            placeholderTextColor={palette.text.tertiary}
            style={inputStyle}
            autoFocus
          />
          <View>
            {(filteredServices || []).slice(0, 80).map((s) => {
              const inLine = serviceLines.find((l) => l.serviceId === s.id);
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.pickRow, { borderBottomColor: palette.border.subtle }]}
                  onPress={() => addService(s)}
                  activeOpacity={0.6}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.pickName, { color: palette.text.primary }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    <Text style={[styles.pickSub, { color: palette.text.tertiary }]}>
                      {formatTemplateMoney(s.defaultPrice ?? 0)}
                    </Text>
                  </View>
                  {inLine ? (
                    <View
                      style={[
                        styles.pickCountBadge,
                        { backgroundColor: isDark ? softTint(colors.primary[600], 'dark') : colors.primary[50] },
                      ]}
                    >
                      <Text
                        style={[styles.pickCountText, { color: isDark ? colors.primary[300] : colors.primary[600] }]}
                      >
                        ×{inLine.quantity}
                      </Text>
                    </View>
                  ) : (
                    <Ionicons name="add-circle-outline" size={20} color={colors.primary[500]} />
                  )}
                </TouchableOpacity>
              );
            })}
            {allServices && filteredServices.length === 0 && (
              <Text style={[styles.pickEmpty, { color: palette.text.tertiary }]}>Ничего не найдено</Text>
            )}
            {!allServices && (
              <View style={{ paddingVertical: spacing[4], alignItems: 'center' }}>
                <ActivityIndicator color={colors.primary[500]} size="small" />
              </View>
            )}
            {filteredServices.length > 80 && (
              <Text style={[styles.pickEmpty, { color: palette.text.tertiary }]}>
                Показаны первые 80 — уточните поиск
              </Text>
            )}
          </View>
        </View>
      </Modal>

      {/* Добавить товар — простой серверный поиск (без полноэкранного пикера). */}
      <Modal visible={showProductPicker} onClose={() => setShowProductPicker(false)} title="Добавить товар">
        <View style={{ gap: spacing[3] }}>
          <TextInput
            value={productSearch}
            onChangeText={setProductSearch}
            placeholder="Поиск товара…"
            placeholderTextColor={palette.text.tertiary}
            style={inputStyle}
            autoFocus
          />
          <View>
            {(productResults || []).map((p) => {
              const inLine = productLines.find((l) => l.productId === p.id);
              return (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.pickRow, { borderBottomColor: palette.border.subtle }]}
                  onPress={() => addProduct(p)}
                  activeOpacity={0.6}
                >
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.pickName, { color: palette.text.primary }]} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Text style={[styles.pickSub, { color: palette.text.tertiary }]}>
                      {formatTemplateMoney(p.sellPrice ?? 0)} · {p.stock ?? 0} шт
                    </Text>
                  </View>
                  {inLine ? (
                    <View
                      style={[
                        styles.pickCountBadge,
                        { backgroundColor: isDark ? softTint(colors.primary[600], 'dark') : colors.primary[50] },
                      ]}
                    >
                      <Text
                        style={[styles.pickCountText, { color: isDark ? colors.primary[300] : colors.primary[600] }]}
                      >
                        ×{inLine.quantity}
                      </Text>
                    </View>
                  ) : (
                    <Ionicons name="add-circle-outline" size={20} color={colors.primary[500]} />
                  )}
                </TouchableOpacity>
              );
            })}
            {productResults && productResults.length === 0 && (
              <Text style={[styles.pickEmpty, { color: palette.text.tertiary }]}>
                {productSearch.trim() ? 'Ничего не найдено' : 'Начните вводить название'}
              </Text>
            )}
            {!productResults && (
              <View style={{ paddingVertical: spacing[4], alignItems: 'center' }}>
                <ActivityIndicator color={colors.primary[500]} size="small" />
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[3.5] },

  card: {
    ...iosCard,
    padding: spacing[4],
    gap: spacing[2],
  },

  fieldLabel: { fontSize: 12, fontWeight: fontWeight.semibold, marginBottom: spacing[1] },
  nameStatic: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: fontSize.base,
  },

  sharedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  sharedTitle: { fontSize: 15, fontWeight: fontWeight.semibold },
  sharedHint: { fontSize: 12 },
  sharedStaticBadge: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  sharedStaticBadgeText: { fontSize: 11, fontWeight: fontWeight.semibold },

  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingTop: spacing[1],
  },
  folderRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[2],
    paddingTop: spacing[3],
  },
  folderValue: { fontSize: 15, fontWeight: fontWeight.medium },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  sectionIcon: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: 15, fontWeight: fontWeight.semibold },
  sectionCount: { fontSize: 13, fontWeight: fontWeight.medium },
  addLineBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLines: { fontSize: 13, paddingVertical: spacing[2] },

  lineItem: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    gap: spacing[2.5],
  },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  lineName: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  lineControls: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] },
  lineStatic: { fontSize: 13, fontWeight: fontWeight.medium },
  priceInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[2.5],
    height: 36,
    gap: 4,
  },
  priceInput: { minWidth: 56, maxWidth: 92, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, padding: 0 },
  priceCurrency: { fontSize: 12 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    height: 36,
    paddingHorizontal: spacing[1],
  },
  stepperBtn: { width: 28, height: 34, alignItems: 'center', justifyContent: 'center' },
  stepperQty: { minWidth: 22, textAlign: 'center', fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  lineTotal: { flex: 1, textAlign: 'right', fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 },
  totalLabel: { fontSize: 13 },
  totalValue: { fontSize: 13, fontWeight: fontWeight.medium },
  totalDivider: { height: StyleSheet.hairlineWidth, marginVertical: spacing[1.5] },
  totalLabelGrand: { fontSize: 15, fontWeight: fontWeight.bold },
  totalValueGrand: { fontSize: 15, fontWeight: fontWeight.bold },

  // Строки пикеров «Добавить услугу / товар»
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  pickName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  pickSub: { fontSize: 12, marginTop: 1 },
  pickCountBadge: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    minWidth: 34,
    alignItems: 'center',
  },
  pickCountText: { fontSize: 12, fontWeight: fontWeight.bold },
  pickEmpty: { fontSize: 12, textAlign: 'center', paddingVertical: spacing[3] },

  saveBtn: {
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.xl,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
  },
  deleteBtnText: { color: colors.red[500], fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
