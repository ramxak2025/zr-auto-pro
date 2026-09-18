import React, { useEffect, useRef, ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, TouchableOpacity, ViewStyle } from 'react-native';

interface AnimatedCardProps {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  index?: number;
  onPress?: () => void;
  /**
   * Optional long-press handler. Forwarded to the underlying
   * TouchableOpacity in both skip-animation and animated branches.
   */
  onLongPress?: () => void;
  /**
   * Optional `onPressIn` — fired on FINGER-DOWN, BEFORE `onPress`.
   * Used to kick off detail-prefetches the moment the user starts a
   * tap, so by the time the navigation push completes the next
   * screen's data is already in cache. Forwarded to TouchableOpacity.
   */
  onPressIn?: () => void;
  activeOpacity?: number;
  /**
   * Force-disable the entrance animation regardless of index. Use this
   * for list rows where the stagger isn't visually meaningful (the
   * user scrolls fast enough that the animation just adds work without
   * adding polish).
   */
  disableEntrance?: boolean;
}

// Cap how many rows participate in the entrance stagger. Anything past
// this index renders as a plain View — usually those rows mount only
// because the user scrolled to them, and animating each as it scrolls
// into view adds bridge work without adding polish (it actually causes
// a small visual hiccup during scroll on iPhone). Keep enough to cover
// "above the fold" on a 6.7" iPhone screen.
const STAGGER_LIMIT = 8;

// Lazily-resolved reduce-motion state. Read once at module load; if it
// flips during the session the next AnimatedCard mount picks it up.
// We can't `await` in a non-async path so we cache the latest known
// value and update on each AccessibilityInfo subscription tick.
let reduceMotionEnabled = false;
AccessibilityInfo.isReduceMotionEnabled?.()
  .then((v) => {
    reduceMotionEnabled = v;
  })
  .catch(() => {});
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v) => {
  reduceMotionEnabled = v;
});

export default function AnimatedCard({
  children,
  style,
  index = 0,
  onPress,
  onLongPress,
  onPressIn,
  activeOpacity = 0.7,
  disableEntrance = false,
}: AnimatedCardProps) {
  // РЕШЕНИЕ ПРИНИМАЕТСЯ ОДИН РАЗ НА МОНТИРОВАНИЕ И БОЛЬШЕ НЕ МЕНЯЕТСЯ.
  //
  // Почему ref, а не обычное выражение: в переиспользуемом списке (FlashList)
  // ОДИН смонтированный инстанс получает то index=3, то index=40. Если решение
  // «анимировать или нет» пересчитывать на каждый рендер, оно скачет через
  // STAGGER_LIMIT туда-обратно — и вместе с ним скакала ФОРМА ДЕРЕВА (см. ниже).
  // React видел другой тип корневого элемента, размонтировал поддерево строки
  // целиком и монтировал заново — вместе с превью товара. Глазом это и есть
  // «карточки мигают, когда листаешь».
  const decidedRef = useRef<boolean | null>(null);
  if (decidedRef.current === null) {
    decidedRef.current = disableEntrance || reduceMotionEnabled || index >= STAGGER_LIMIT;
  }
  const skipAnimation = decidedRef.current;

  // Premium entry = calm opacity fade-in. No scale-up, no Y-translation
  // bounce — those read as "springy" / "bouncy" and clash with the iOS-
  // native materials this app uses. The stagger is kept so cards still
  // appear sequentially, just calmly.
  const fadeAnim = useRef(new Animated.Value(skipAnimation ? 1 : 0)).current;

  // Вход играется РОВНО ОДИН РАЗ за монтирование. Пустой массив зависимостей —
  // не забывчивость: пере-запуск на смене index означал бы, что переиспользованная
  // строка проявляется заново при каждом обороте скролла.
  useEffect(() => {
    if (skipAnimation) return;
    const delay = Math.min(index * 40, 240);
    const anim = Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 180,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ФОРМА ДЕРЕВА — ИНВАРИАНТ. Один и тот же корень (Animated.View) при любом
  // index, при любом skipAnimation, на любом обороте переиспользования. Раньше
  // корень менялся с Animated.View на TouchableOpacity и обратно, и React
  // пересобирал строку целиком. Когда анимации нет, opacity просто равен 1 —
  // нативный драйвер по такому значению не делает ни одного кадра работы.
  const animatedStyle = { opacity: fadeAnim };

  if (onPress) {
    return (
      <Animated.View style={animatedStyle}>
        <TouchableOpacity
          style={style}
          onPress={onPress}
          onPressIn={onPressIn}
          onLongPress={onLongPress}
          activeOpacity={activeOpacity}
        >
          {children}
        </TouchableOpacity>
      </Animated.View>
    );
  }

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}
