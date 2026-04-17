import React, { useState, useMemo, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  Dimensions, Image, Animated, Modal as RNModal, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Product } from '../../../shared/types';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

function formatMoney(v: number) {
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

export interface FolderAnnotation {
  label: string;
  color: string;
}

interface ProductPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectProduct: (product: Product) => void;
  getCartQty?: (productId: string) => number;
  title?: string;
  showCostPrice?: boolean;
  folderAnnotations?: Map<string, FolderAnnotation>;
}

export default function ProductPickerModal({
  visible,
  onClose,
  onSelectProduct,
  getCartQty,
  title = 'Товары',
  showCostPrice = false,
  folderAnnotations,
}: ProductPickerModalProps) {
  const [productPath, setProductPath] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState('');

  // Shares ['products', ...] cache with main ProductsScreen so mutations
  // automatically invalidate the picker too. refetchOnMount:'always' ensures
  // a fresh list every time the modal opens — prevents intermittent empty list.
  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ['products', 'picker', 5000],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 5000 });
      return res.data?.data || res.data;
    },
    enabled: visible,
    refetchOnMount: 'always',
    staleTime: 0,
  });

  const { productFolders, visibleProducts } = useMemo(() => {
    const products = allProducts || [];
    if (productSearch) {
      const q = productSearch.toLowerCase();
      return {
        productFolders: new Map<string, number>(),
        visibleProducts: products.filter(
          p => p.name.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q))
        ),
      };
    }

    const subs = new Map<string, number>();
    const prods: Product[] = [];

    for (const p of products) {
      const cat = p.category || '';
      const catParts = cat ? cat.split('/') : [];
      const matchesPath = productPath.every((seg, i) => catParts[i] === seg);
      if (!matchesPath && productPath.length > 0) continue;

      if (catParts.length > productPath.length) {
        const folderName = catParts[productPath.length];
        subs.set(folderName, (subs.get(folderName) || 0) + 1);
      } else if (catParts.length === productPath.length) {
        prods.push(p);
      }
    }

    if (productPath.length === 0) {
      for (const p of products) {
        if (!p.category && !prods.includes(p)) prods.push(p);
      }
    }

    return { productFolders: subs, visibleProducts: prods };
  }, [allProducts, productPath, productSearch]);

  const sortedProductFolders = Array.from(productFolders.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  // Swipe-to-go-back
  const panX = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dx > 15 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5 && gs.x0 < 40,
      onPanResponderMove: (_, gs) => {
        if (gs.dx > 0) panX.setValue(gs.dx);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > 100) {
          if (productPath.length > 0) {
            setProductPath(prev => prev.slice(0, -1));
          } else {
            handleClose();
          }
        }
        Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
      },
    })
  ).current;

  const handleClose = () => {
    setProductSearch('');
    setProductPath([]);
    onClose();
  };

  return (
    <RNModal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={handleClose} />
        <Animated.View
          style={[styles.container, { transform: [{ translateX: panX }] }]}
          {...panResponder.panHandlers}
        >
          {/* Handle bar */}
          <View style={styles.handle}>
            <View style={styles.handleBar} />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={colors.gray[600]} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{title}</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={16} color={colors.gray[400]} />
            <TextInput
              value={productSearch}
              onChangeText={setProductSearch}
              style={styles.searchInput}
              placeholder="Поиск товара..."
              placeholderTextColor={colors.gray[400]}
            />
            {productSearch ? (
              <TouchableOpacity onPress={() => setProductSearch('')}>
                <Ionicons name="close-circle" size={18} color={colors.gray[400]} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Breadcrumbs */}
          {!productSearch && productPath.length > 0 && (
            <View style={styles.breadcrumbRow}>
              <TouchableOpacity onPress={() => setProductPath([])} style={styles.breadcrumbItem}>
                <Ionicons name="home-outline" size={14} color={colors.primary[600]} />
              </TouchableOpacity>
              {productPath.map((seg, i) => (
                <React.Fragment key={i}>
                  <Ionicons name="chevron-forward" size={12} color={colors.gray[300]} />
                  <TouchableOpacity onPress={() => setProductPath(prev => prev.slice(0, i + 1))} style={styles.breadcrumbItem}>
                    <Text style={[styles.breadcrumbText, i === productPath.length - 1 && { color: colors.gray[900], fontWeight: fontWeight.bold }]}>{seg}</Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
          )}

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: spacing[4], paddingBottom: spacing[12] }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Folders */}
            {!productSearch && sortedProductFolders.length > 0 && (
              <View style={styles.foldersGrid}>
                {sortedProductFolders.map(([name, count]) => {
                  const annotation = folderAnnotations?.get(name);
                  return (
                    <TouchableOpacity key={name} style={styles.folderCard} onPress={() => setProductPath(prev => [...prev, name])}>
                      <Ionicons name="folder-open" size={22} color={colors.primary[500]} />
                      <Text style={styles.folderName} numberOfLines={2}>{name}</Text>
                      <Text style={styles.folderCount}>{count} тов.</Text>
                      {annotation && (
                        <Text style={[styles.folderAnnotation, { color: annotation.color }]} numberOfLines={1}>
                          {annotation.label}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Products */}
            {visibleProducts.map(product => {
              const cartQty = getCartQty ? getCartQty(product.id) : 0;
              const photoUrl = getImageUrl((product as any).photo);
              const price = showCostPrice ? product.costPrice : product.sellPrice;
              return (
                <TouchableOpacity key={product.id} style={styles.productItem} onPress={() => onSelectProduct(product)} activeOpacity={0.6}>
                  {photoUrl ? (
                    <Image source={{ uri: photoUrl }} style={styles.productPhoto} />
                  ) : (
                    <View style={[styles.productPhoto, styles.productPhotoPlaceholder]}>
                      <Ionicons name="cube-outline" size={20} color={colors.gray[300]} />
                    </View>
                  )}
                  <View style={styles.productInfo}>
                    <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 2 }}>
                      <Text style={styles.productPrice}>{formatMoney(price)}</Text>
                      <Text style={styles.productStock}>Ост: {product.stock} шт</Text>
                    </View>
                  </View>
                  {cartQty > 0 ? (
                    <View style={styles.cartBadge}>
                      <Text style={styles.cartBadgeText}>{cartQty}</Text>
                    </View>
                  ) : (
                    <Ionicons name="add-circle" size={28} color={colors.primary[500]} />
                  )}
                </TouchableOpacity>
              );
            })}

            {!productSearch && sortedProductFolders.length === 0 && visibleProducts.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: spacing[8] }}>
                <Ionicons name="cube-outline" size={40} color={colors.gray[300]} />
                <Text style={{ color: colors.gray[400], marginTop: spacing[2] }}>Нет товаров</Text>
              </View>
            )}
            {productSearch && visibleProducts.length === 0 && (
              <View style={{ alignItems: 'center', paddingVertical: spacing[8] }}>
                <Ionicons name="search-outline" size={40} color={colors.gray[300]} />
                <Text style={{ color: colors.gray[400], marginTop: spacing[2] }}>Ничего не найдено</Text>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  container: {
    height: SCREEN_HEIGHT * 0.82,
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  handle: { alignItems: 'center', paddingVertical: spacing[2] },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.gray[300] },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[2],
    borderBottomWidth: 1, borderBottomColor: colors.gray[100],
  },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.gray[50],
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[2],
    marginHorizontal: spacing[4], marginVertical: spacing[2],
    backgroundColor: colors.gray[50], borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2.5],
  },
  searchInput: { flex: 1, fontSize: fontSize.sm, color: colors.gray[900], paddingVertical: 0 },
  breadcrumbRow: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[1],
    paddingHorizontal: spacing[4], paddingBottom: spacing[1],
  },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], paddingVertical: 2 },
  breadcrumbText: { fontSize: fontSize.xs, color: colors.primary[600], fontWeight: fontWeight.medium },
  foldersGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], marginBottom: spacing[4] },
  folderCard: {
    width: (SCREEN_WIDTH - spacing[4] * 2 - spacing[3] * 2) / 3,
    backgroundColor: colors.gray[50], borderRadius: borderRadius.xl,
    borderWidth: 1, borderColor: colors.gray[100],
    padding: spacing[3], alignItems: 'center', gap: spacing[1],
  },
  folderName: { fontSize: 12, fontWeight: fontWeight.semibold, color: colors.gray[900], textAlign: 'center', lineHeight: 16 },
  folderCount: { fontSize: 10, color: colors.gray[400] },
  folderAnnotation: { fontSize: 9, fontWeight: fontWeight.medium, marginTop: 2, textAlign: 'center' },
  productItem: {
    flexDirection: 'row', alignItems: 'center', gap: spacing[3],
    paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[50],
  },
  productPhoto: { width: 52, height: 52, borderRadius: borderRadius.lg },
  productPhotoPlaceholder: { backgroundColor: colors.gray[50], alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.gray[100] },
  productInfo: { flex: 1, minWidth: 0 },
  productName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  productPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  productStock: { fontSize: fontSize.xs, color: colors.gray[400] },
  cartBadge: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary[600],
    alignItems: 'center', justifyContent: 'center',
  },
  cartBadgeText: { fontSize: 13, fontWeight: fontWeight.bold, color: colors.white },
});
