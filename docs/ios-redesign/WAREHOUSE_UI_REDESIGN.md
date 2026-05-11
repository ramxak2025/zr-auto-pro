# Warehouse / Products UI — redesign

## Был сломан

Каждый товар отображался как:
- Карточка с `borderRadius: 16`, `borderWidth: 1`, `padding: 12`, тенью `shadowOpacity: 0.04`
- Фото 52×52
- Между карточками gap 8pt
- Высота row ~110pt
- На iPhone 17 Pro помещалось ~6 товаров на экран

Это **Material Design** ощущение, не iOS. Apple Settings / Mail / Contacts используют **plain list** — белая поверхность, тонкие hairline-разделители, компактные строки.

## Что переделано

### Стили (`mobile/src/screens/ProductsScreen.tsx`)

```ts
// БЫЛО
productCard: {
  backgroundColor: white,
  borderRadius: borderRadius['2xl'],   // 16
  borderWidth: 1,
  borderColor: gray[100],
  padding: spacing[3],                  // 12
  shadowColor: black,
  shadowOpacity: 0.04,
  shadowRadius: 3,
  elevation: 1,
}

// СТАЛО
productCard: {
  backgroundColor: white,
  paddingHorizontal: spacing[3],        // 12
  paddingVertical: spacing[2.5],        // 10
  borderBottomWidth: StyleSheet.hairlineWidth,  // 0.33-0.5pt
  borderBottomColor: gray[200],
}
```

```ts
// Photo: 52 → 42, borderRadius lg → md
productPhoto: { width: 42, height: 42, borderRadius: borderRadius.md }
productPhotoPlaceholder: { width: 42, height: 42, borderRadius: borderRadius.md, backgroundColor: gray[100] }

// Typography: тоньше иерархия
productName: { fontSize: 15, fontWeight: '600', color: gray[900], letterSpacing: -0.1 }
productCategory: { fontSize: 11, color: gray[400], marginTop: 1 }
productSellPrice: { fontSize: 13, fontWeight: '600', color: primary[700] }  // primary tint выделяет цену
productCostPrice: { fontSize: 11, color: gray[400] }
productStock: { fontSize: 16, fontWeight: '700', letterSpacing: -0.3 }
productStockLabel: { fontSize: 10, color: gray[400] }
```

```ts
// list — без gap, без horizontal padding (rows сами держат padding)
list: { paddingHorizontal: 0, paddingTop: 0 }
```

## Результат

- Высота row: ~110pt → **~62pt** (≈45% экономии вертикали)
- На iPhone 17 Pro помещается **~10 товаров** на экран (раньше 6)
- Information hierarchy чище:
  - Имя товара 15pt SemiBold
  - Категория 11pt gray400 (вторичная)
  - Цена 13pt SemiBold primary700 (акцент через цвет)
  - Себестоимость 11pt gray400 (только директор/админ видит)
  - Остаток справа 16pt Bold + 10pt label
- Hairline separators заменили individual borders — это «iOS-grouped list» feeling
- AnimatedCard fade-in entry сохранён

## Что НЕ изменилось

- Логика fetch (TanStack Query)
- FlashList performance (estimatedItemSize не нужен — flash-list@2 определяет автоматически)
- Хлебные крошки сверху списка
- Сводные карточки (Себестоимость склада / В розн. ценах)
- Header «Склад» с кнопками операций и добавления
- Skeleton states (`<ListSkeleton count={8} />` при `isLoading || data === undefined`)
- Empty state (только когда query завершён с пустым результатом)
- Pull-to-refresh

## Acceptance — все ✅

- [x] Карточки больше не выглядят как Material — это iOS plain list
- [x] Высота row уменьшена ~45%
- [x] Иерархия информации чище
- [x] Производительность не упала (FlashList сохраняется)
- [x] Loading + empty states работают как раньше
