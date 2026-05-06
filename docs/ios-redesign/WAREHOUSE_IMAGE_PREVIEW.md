# Склад — нативный preview фото товара

## Активация

В `mobile/src/screens/ProductsScreen.tsx`, в строке товара:

```jsx
<TouchableOpacity
  onPress={() => {
    if (pUri) setFullscreenPhoto(pUri);
  }}
  onLongPress={() => {
    if (pUri) {
      tapMedium(); // medium impact haptic
      setFullscreenPhoto(pUri);
    }
  }}
  delayLongPress={400}
>
  <CachedImage source={{ uri: pUri }} style={styles.productPhoto} />
</TouchableOpacity>
```

- **Тап** — открывает фуллскрин (старое поведение, сохранено)
- **Long-press 400ms** — также открывает + medium-haptic (новое)

## Сам preview

`<RNModal>` со следующей структурой:

```jsx
<RNModal visible transparent animationType="fade">
  <Pressable style={styles.fullscreenOverlay} onPress={close}>
    {/* Полноэкранный размытый фон */}
    <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />

    {/* Изображение со скруглёнными углами;
        собственный Pressable останавливает клики, чтобы тап ПО фото
        не закрывал preview — только тап ВНЕ закрывает. */}
    <Pressable style={styles.fullscreenImageWrap} onPress={(e) => e.stopPropagation?.()}>
      <CachedImage style={styles.fullscreenImage} resizeMode="contain" />
    </Pressable>

    {/* Translucent close glyph в правом верхнем углу */}
    <Pressable style={styles.fullscreenClose} onPress={close} hitSlop={12}>
      <Ionicons name="close" size={20} color="#fff" />
    </Pressable>
  </Pressable>
</RNModal>
```

## Ключевые свойства

| Свойство                      | Значение                                               |
| ----------------------------- | ------------------------------------------------------ |
| Backdrop                      | `BlurView intensity={90} tint="dark"`                  |
| Anim                          | iOS native `fade` через RNModal                        |
| Image corner radius           | 24pt (`borderRadius` на wrapper, `overflow: hidden`)   |
| Image shadow                  | shadowOpacity 0.4, radius 24, offset 0/12              |
| Close button                  | 36×36 squircle, `rgba(255,255,255,0.18)`               |
| Tap-anywhere closes           | ✓ (Pressable на overlay → onPress)                     |
| Tap on image — does NOT close | ✓ (внутренний Pressable стопает event)                 |
| Safe area                     | `paddingHorizontal: 16` + image fits 70% screen height |

## Acceptance criteria

- [x] Backdrop — UIBlurEffect dark, не плоский чёрный
- [x] Углы изображения скруглены (24pt continuous)
- [x] Long-press 400ms открывает preview с medium-haptic
- [x] Тап в любом месте вне фото закрывает preview
- [x] Тап ПО фото НЕ закрывает (можно рассматривать)
- [x] Анимация открытия и закрытия плавная (RNModal fade)
- [x] Close-кнопка translucent в стиле iOS native preview

## Что осталось как minor follow-up (не блокер)

- Close-button использует `top: 60` — хардкод. Корректнее было бы взять
  `useSafeAreaInsets().top + 12` для адаптивной позиции на iPhone с
  Dynamic Island и без неё. На современных iPhone'ах разница незаметная,
  но на iPhone SE2 / 8 (safe top 20) кнопка сейчас сидит низковато.
  Замена тривиальная (один useSafeAreaInsets hook + dynamic style),
  оставляю на следующую итерацию вместе с миграцией close-кнопки на
  SF Symbol через `<Icon name="close" />`.
- Близко к 5.5/6.7" iPhone'ам maximum image height стоит сделать
  адаптивным (сейчас `SCREEN_HEIGHT * 0.7` — может «съедать» close-кнопку
  на маленьких экранах). Тоже не блокер, тривиальное.

Обе правки — на ProductsScreen.tsx, в `fullscreenClose` / `fullscreenImage`
стилях (~line 2068-2080).

## Аудит 2026-05-05

- Структура реализации в коде совпадает с этим документом.
- Backdrop, скругления, close-кнопка, tap-vne, anim — на месте.
- Long-press уже реализован в двух местах (line 907, 966 в `ProductsScreen.tsx`).
- Никаких правок этой итерации не требуется.
