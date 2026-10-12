import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Linking } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { starterCatalogsApi, warehousesApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './Button';
import StarterDirectionsPicker from './StarterDirectionsPicker';
import { apiErrorMessage } from '../../../shared/utils/apiError';
import type {
  StarterPart,
  StarterPreview,
  StarterResolution,
  StarterInstallResult,
} from '../../../shared/types/starterCatalogs';
const labels: Record<StarterPart, string> = { services: 'Услуги', products: 'Товары и папки', templates: 'Шаблоны' };
const groups = {
  services: 'Услуги',
  products: 'Товары',
  templates: 'Шаблоны',
  productFolders: 'Папки товаров',
  serviceFolders: 'Папки услуг',
  templateFolders: 'Папки шаблонов',
};
export default function StarterCatalogsSection() {
  const { user } = useAuth();
  const owner = user?.role === 'director' || user?.role === 'superadmin';
  const palette = useColors();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [directionIds, setDirections] = useState<string[]>([]);
  const [parts, setParts] = useState<StarterPart[]>(['services', 'products', 'templates']);
  const [warehouseId, setWarehouseId] = useState('');
  const [preview, setPreview] = useState<StarterPreview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, StarterResolution>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StarterInstallResult | null>(null);
  const warehousesQuery = useQuery({
    queryKey: ['starter-warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
    enabled: owner && open,
  });
  const warehouses = warehousesQuery.data?.filter((w) => w.kind === 'main') ?? [];
  if (!owner) return null;
  const body = { fontSize: 14, lineHeight: 20, color: palette.text.secondary };
  const choice = (label: string, selected: boolean, onPress: () => void, key = label) => (
    <TouchableOpacity
      key={key}
      disabled={busy}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled: busy }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}
    >
      <Ionicons name={selected ? 'checkbox' : 'square-outline'} size={24} color={palette.accent.primary} />
      <Text style={{ fontSize: 15, flex: 1, color: palette.text.primary }}>{label}</Text>
    </TouchableOpacity>
  );
  const load = async () => {
    setBusy(true);
    setError('');
    try {
      setPreview(
        (await starterCatalogsApi.preview({ directionIds, parts, warehouseId: warehouseId || warehouses[0]?.id })).data,
      );
      setResolutions({});
    } catch (e) {
      setError(apiErrorMessage(e) ?? 'Не удалось открыть предпросмотр');
    } finally {
      setBusy(false);
    }
  };
  const install = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      setResult((await starterCatalogsApi.install({ previewId: preview.id, resolutions })).data);
      await Promise.all(
        ['products', 'services', 'check-templates', 'warehouse-categories', 'service-folders'].map((key) =>
          client.invalidateQueries({ queryKey: [key] }),
        ),
      );
    } catch (e) {
      setError(apiErrorMessage(e) ?? 'Установка не завершена. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ backgroundColor: palette.bg.card, borderRadius: 16, padding: 16, gap: 16, marginBottom: 16 }}>
      <View>
        <Text style={{ fontSize: 18, fontWeight: '600', color: palette.text.primary }}>Стартовые каталоги</Text>
        <Text style={[body, { marginTop: 4 }]}>Готовая основа для легковых автомобилей</Text>
      </View>
      {!open ? (
        <Button title="Выбрать направления" variant="secondary" onPress={() => setOpen(true)} />
      ) : result ? (
        <>
          <Text style={{ fontSize: 16, fontWeight: '600', color: palette.text.primary }} accessibilityRole="header">
            Каталоги установлены
          </Text>
          <Text style={body}>
            Добавлено: {result.added}. Использовано существующих: {result.reused}. Пропущено: {result.skipped}.
            Восстановлено: {result.restored}.
          </Text>
          <Text style={body}>
            Настройте и подтвердите цены перед работой. Закупочная цена 1 ₽ пока не является подтверждённой
            себестоимостью.
          </Text>
          <Button
            title="Выбрать ещё направления"
            variant="secondary"
            onPress={() => {
              setResult(null);
              setPreview(null);
            }}
          />
        </>
      ) : !preview ? (
        <>
          <StarterDirectionsPicker value={directionIds} onChange={setDirections} disabled={busy} />
          <View>
            <Text style={{ fontSize: 16, fontWeight: '600', color: palette.text.primary }}>Состав набора</Text>
            {(Object.keys(labels) as StarterPart[]).map((p) =>
              choice(labels[p], parts.includes(p), () =>
                setParts(parts.includes(p) ? parts.filter((x) => x !== p) : [...parts, p]),
              ),
            )}
          </View>
          <Text style={body}>
            Шаблоны используют уже установленные позиции. Для отсутствующих услуг и товаров включите соответствующую
            часть набора.
          </Text>
          <View>
            <Text style={{ fontSize: 16, fontWeight: '600', color: palette.text.primary }}>
              Основной склад для товаров
            </Text>
            {warehouses.map((w) =>
              choice(w.name, (warehouseId || warehouses[0]?.id) === w.id, () => setWarehouseId(w.id), w.id),
            )}
          </View>
          {warehousesQuery.isError && (
            <Button
              title="Повторить загрузку складов"
              variant="ghost"
              onPress={() => {
                void warehousesQuery.refetch();
              }}
            />
          )}
          <Button
            title="Посмотреть состав"
            onPress={load}
            loading={busy}
            disabled={!directionIds.length || !parts.length || !warehouses.length}
          />
        </>
      ) : (
        <>
          <Text style={{ fontSize: 16, fontWeight: '600', color: palette.text.primary }}>Предпросмотр установки</Text>
          <Text style={body}>
            Склад: {warehouses.find((w) => w.id === preview.warehouseId)?.name ?? 'Основной склад'}. Новые цены — 1 ₽,
            остатки — 0. Ваши цены и настройки сохранятся.
          </Text>
          {Object.entries(groups).map(([kind, label]) => {
            const items = preview.items.filter((i) => i.kind === kind);
            return (
              items.length > 0 && (
                <View key={kind} style={{ gap: 4 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: palette.text.primary }}>
                    {label} · {items.length}
                  </Text>
                  {items.map((item) => (
                    <View
                      key={item.key}
                      style={{
                        paddingVertical: 12,
                        borderBottomWidth: 0.5,
                        borderBottomColor: palette.border.subtle,
                        gap: 4,
                      }}
                    >
                      <Text style={{ fontSize: 15, color: palette.text.primary }}>{item.name}</Text>
                      <Text style={body}>
                        {
                          {
                            add: 'Добавится',
                            reuse: 'Уже есть',
                            ambiguous: 'Есть совпадение',
                            deleted: 'Удалено — пропустить',
                            blocked: 'Не хватает позиций — включите услуги или товары',
                          }[item.status]
                        }
                      </Text>
                      <Text style={body}>
                        {item.category}
                        {item.article ? ` · Артикул ${item.article}` : ''}
                      </Text>
                      {item.note && <Text style={body}>{item.note}</Text>}
                      {item.sourceUrl && (
                        <TouchableOpacity
                          accessibilityRole="link"
                          onPress={() => {
                            void Linking.openURL(item.sourceUrl!);
                          }}
                          style={{ minHeight: 44, justifyContent: 'center' }}
                        >
                          <Text style={{ color: palette.accent.primary }}>Источник производителя</Text>
                        </TouchableOpacity>
                      )}
                      {item.status === 'ambiguous' && (
                        <View>
                          {choice('Добавить отдельную позицию', resolutions[item.key]?.action === 'separate', () =>
                            setResolutions({ ...resolutions, [item.key]: { action: 'separate' } }),
                          )}
                          {choice('Пропустить', resolutions[item.key]?.action === 'skip', () =>
                            setResolutions({ ...resolutions, [item.key]: { action: 'skip' } }),
                          )}
                          {item.candidates.map((c) =>
                            choice(
                              `Использовать: ${c.name} · ${c.id.slice(0, 8)}`,
                              resolutions[item.key]?.resourceId === c.id,
                              () =>
                                setResolutions({ ...resolutions, [item.key]: { action: 'reuse', resourceId: c.id } }),
                              c.id,
                            ),
                          )}
                        </View>
                      )}
                      {item.status === 'deleted' &&
                        choice('Восстановить эту позицию', resolutions[item.key]?.action === 'restore', () =>
                          setResolutions({
                            ...resolutions,
                            [item.key]: { action: resolutions[item.key]?.action === 'restore' ? 'skip' : 'restore' },
                          }),
                        )}
                    </View>
                  ))}
                </View>
              )
            );
          })}
          <Button
            title="Установить выбранное"
            onPress={install}
            loading={busy}
            disabled={preview.items.some((i) => i.status === 'ambiguous' && !resolutions[i.key])}
          />
          <Button
            title="Изменить выбор"
            variant="secondary"
            disabled={busy}
            onPress={() => {
              setPreview(null);
              setError('');
            }}
          />
          <Button title="Обновить предпросмотр" variant="ghost" disabled={busy} onPress={load} />
        </>
      )}
      {error && (
        <Text accessibilityRole="alert" style={{ fontSize: 14, color: palette.text.primary }}>
          {error}
        </Text>
      )}
    </View>
  );
}
