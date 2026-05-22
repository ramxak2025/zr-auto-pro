/**
 * BottomSheet — gesture-driven sheet built on Reanimated 4 + gesture-handler.
 *
 *  • Drag the handle (or anywhere on the sheet header) to dismiss.
 *  • Backdrop fades in/out with the sheet position so the dismissal feels
 *    physical, not stepped.
 *  • Spring snap on release: half-throw → close, otherwise rubber-band back.
 *  • Adaptive: iOS gets a tighter spring (Apple feel), Android the M3 timing.
 *  • Uses RN core <Modal> as the host so the sheet floats above app navigation,
 *    keyboard, and the new tab bar without z-index gymnastics.
 *
 * API mirrors the existing <Modal /> so screens can swap to BottomSheet with
 * one rename.
 */
import React from 'react';
import { Modal as RNModal, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../platform/Icon';
import { PressableScale } from '../platform/PressableScale';
import { SPRING_TIGHT, TIMING_STANDARD, preferSpring } from '../platform/motion';
import { Text } from '../platform/Typography';
import { colors } from '../theme';

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Sheet height as ratio of screen height. Default 0.7 (70%). */
  heightRatio?: number;
  children?: React.ReactNode;
}

export function BottomSheet({ visible, onClose, title, heightRatio = 0.7, children }: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(1000); // off-screen by default
  const lastOffset = useSharedValue(0);
  const sheetHeight = useSharedValue(0);

  const close = React.useCallback(() => {
    onClose();
  }, [onClose]);

  // Animate in/out when `visible` flips
  React.useEffect(() => {
    if (visible) {
      // Mount with sheet off-screen, then pull up
      translateY.value = sheetHeight.value || 800;
      const spec = preferSpring ? withSpring(0, SPRING_TIGHT) : withTiming(0, TIMING_STANDARD);
      translateY.value = spec;
    } else {
      translateY.value = withTiming(sheetHeight.value || 800, { duration: 220 });
    }
  }, [visible, translateY, sheetHeight]);

  // Pan gesture — drag down to close
  const pan = Gesture.Pan()
    .onStart(() => {
      lastOffset.value = translateY.value;
    })
    .onUpdate((e) => {
      // Only respond to downward drag from the resting position
      const next = lastOffset.value + e.translationY;
      translateY.value = Math.max(0, next);
    })
    .onEnd((e) => {
      const past = translateY.value > sheetHeight.value * 0.35 || e.velocityY > 800;
      if (past) {
        translateY.value = withTiming(sheetHeight.value, { duration: 200 });
        runOnJS(close)();
      } else {
        translateY.value = preferSpring ? withSpring(0, SPRING_TIGHT) : withTiming(0, TIMING_STANDARD);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, sheetHeight.value || 600], [1, 0], Extrapolation.CLAMP),
  }));

  return (
    <RNModal visible={visible} transparent onRequestClose={close} statusBarTranslucent animationType="none">
      <View style={styles.host}>
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <PressableScale style={StyleSheet.absoluteFill} onPress={close} hapticIntent={null}>
            <View />
          </PressableScale>
        </Animated.View>

        <Animated.View
          onLayout={(e) => {
            sheetHeight.value = e.nativeEvent.layout.height;
          }}
          style={[
            styles.sheet,
            {
              maxHeight: `${heightRatio * 100}%` as `${number}%`,
              paddingBottom: Math.max(insets.bottom, 12),
            },
            sheetStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.headerArea}>
              <View style={styles.handle} />
              {(title || true) && (
                <View style={styles.header}>
                  {title ? (
                    <Text variant="title3" style={{ flex: 1 }}>
                      {title}
                    </Text>
                  ) : (
                    <View style={{ flex: 1 }} />
                  )}
                  <PressableScale onPress={close} style={styles.closeBtn} hapticIntent={null}>
                    <Icon name="close" size={18} color={colors.gray[500]} />
                  </PressableScale>
                </View>
              )}
            </View>
          </GestureDetector>
          <View style={styles.body}>{children}</View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    overflow: 'hidden',
  },
  headerArea: {
    paddingTop: 6,
    paddingBottom: 4,
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray[300],
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 6,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: colors.gray[100],
  },
  body: {
    paddingHorizontal: 18,
    paddingTop: 12,
    flexShrink: 1,
  },
});
