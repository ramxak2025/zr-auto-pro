import type { ProductsStackParamList } from '../../navigation/AppNavigator';
import React, { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, type NavigationProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { useColors } from '../../contexts/ThemeContext';
import IosScreenHeader from '../../components/IosScreenHeader';
import { TabBarScrollView } from '../../components/TabBarScrollable';
import { ListSkeleton } from '../../components/Skeleton';
export default function LowStockView({ onExit }: { onExit: () => void }) {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('warehouse_access');
  const p = useColors();
  const navigation = useNavigation<NavigationProp<ProductsStackParamList>>();
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['products', 'low-stock-list', user?.id, user?.currentPointId, page],
    queryFn: async () => (await productsApi.getAll({ lowStock: true, warehouseId: 'all', page, limit: 50 })).data,
    enabled: allowed,
    placeholderData: undefined,
  });
  if (!allowed)
    return (
      <View style={{ flex: 1, backgroundColor: p.bg.canvas }}>
        <IosScreenHeader title="Товары на исходе" onBack={onExit} />
        <Text style={{ padding: 16, color: p.text.secondary }}>Нет доступа к складу</Text>
      </View>
    );
  return (
    <View style={{ flex: 1, backgroundColor: p.bg.canvas }}>
      <IosScreenHeader title="Товары на исходе" onBack={onExit} />
      <TabBarScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onExit}
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={{ color: p.text.primary }}>Открыть склад</Text>
        </TouchableOpacity>
        <Text style={{ color: p.text.secondary }}>Все склады текущего филиала · остаток не выше минимального</Text>
        {query.isLoading ? (
          <ListSkeleton />
        ) : query.isError ? (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={query.isFetching}
            onPress={() => query.refetch()}
            style={{ minHeight: 48, justifyContent: 'center' }}
          >
            <Text style={{ color: p.text.primary }}>Не удалось загрузить товары. Повторить</Text>
          </TouchableOpacity>
        ) : (
          <>
            <Text style={{ color: p.text.secondary }}>Всего: {query.data?.total ?? 0}</Text>
            {query.data?.data.map((item) => (
              <TouchableOpacity
                key={item.id}
                accessibilityRole="button"
                onPress={() => navigation.navigate('ProductDetail', { product: item })}
                style={{
                  minHeight: 56,
                  flexDirection: 'row',
                  gap: 12,
                  alignItems: 'center',
                  borderBottomWidth: 0.5,
                  borderBottomColor: p.border.subtle,
                }}
              >
                <Text style={{ flex: 1, color: p.text.primary }}>{item.name}</Text>
                <Text style={{ color: p.text.primary, fontVariant: ['tabular-nums'] }}>
                  {item.stock} / мин. {item.minStock}
                </Text>
              </TouchableOpacity>
            ))}
            {!query.data?.total && (
              <Text style={{ color: p.text.secondary }}>Все товары выше минимального остатка</Text>
            )}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={page === 1}
                onPress={() => setPage(page - 1)}
                style={{ minHeight: 48, justifyContent: 'center', opacity: page === 1 ? 0.4 : 1 }}
              >
                <Text style={{ color: p.text.primary }}>Назад</Text>
              </TouchableOpacity>
              <Text style={{ color: p.text.secondary }}>{page}</Text>
              <TouchableOpacity
                accessibilityRole="button"
                disabled={page * 50 >= (query.data?.total ?? 0)}
                onPress={() => setPage(page + 1)}
                style={{
                  minHeight: 48,
                  justifyContent: 'center',
                  opacity: page * 50 >= (query.data?.total ?? 0) ? 0.4 : 1,
                }}
              >
                <Text style={{ color: p.text.primary }}>Далее</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </TabBarScrollView>
    </View>
  );
}
