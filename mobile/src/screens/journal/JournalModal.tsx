import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAvoidingView, KeyboardProvider } from 'react-native-keyboard-controller';
import { useColors } from '../../contexts/ThemeContext';
import { useJournalReducedMotion, useJournalReducedTransparency } from './JournalMotion';

export type JournalMenuAnchor = { x: number; y: number; width: number; height: number };

/** A stale closing completion must never remove a surface that has reopened. */
export function canFinishJournalExit(finished: boolean | undefined, run: number, latest: number, visible: boolean) {
  return Boolean(finished) && run === latest && !visible;
}

export default function JournalModal({
  visible,
  onRequestClose,
  onDismiss,
  children,
  menu = false,
  anchor,
}: {
  visible: boolean;
  onRequestClose: () => void;
  onDismiss?: () => void;
  children: React.ReactNode;
  menu?: boolean;
  anchor?: JournalMenuAnchor;
}) {
  const p = useColors();
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const reduced = useJournalReducedMotion();
  const opaque = useJournalReducedTransparency();
  const [mounted, setMounted] = useState(visible);
  const scrim = useSharedValue(0);
  const panel = useSharedValue(0);
  const drag = useSharedValue(0);
  const panelHeight = useSharedValue(height);
  const open = useRef(visible);
  const generation = useRef(0);
  const dismissRef = useRef(onDismiss || onRequestClose);
  open.current = visible;
  dismissRef.current = onDismiss || onRequestClose;
  const dismiss = () => {
    if (open.current) dismissRef.current();
  };
  const finishExit = useCallback((run: number, finished: boolean | undefined) => {
    if (canFinishJournalExit(finished, run, generation.current, open.current)) setMounted(false);
  }, []);
  useEffect(() => {
    if (visible) setMounted(true);
  }, [visible]);
  useEffect(() => {
    if (!mounted) return;
    const run = ++generation.current;
    cancelAnimation(panel);
    cancelAnimation(scrim);
    if (visible) {
      drag.value = 0;
      panel.value = reduced
        ? withTiming(1, { duration: 90 })
        : menu
          ? withTiming(1, { duration: 190, easing: Easing.out(Easing.exp) })
          : withSpring(1, { duration: 290, dampingRatio: 1 });
    } else {
      panel.value = withTiming(
        0,
        { duration: reduced ? 90 : menu ? 150 : 220, easing: Easing.in(Easing.cubic) },
        (finished) => {
          runOnJS(finishExit)(run, finished);
        },
      );
    }
    scrim.value = withTiming(visible ? 1 : 0, { duration: reduced ? 90 : 180, easing: Easing.out(Easing.cubic) });
    return () => {
      ++generation.current;
      cancelAnimation(panel);
      cancelAnimation(scrim);
    };
  }, [visible, mounted, reduced, menu, panel, scrim, drag, finishExit]);
  const shade = useAnimatedStyle(() => ({
    opacity: scrim.value * (1 - Math.min(0.85, drag.value / Math.max(1, panelHeight.value))),
  }));
  const surface = useAnimatedStyle(() => ({
    opacity: reduced || menu ? panel.value : 1,
    transform: [
      {
        translateY: reduced
          ? 0
          : menu
            ? -7 * (1 - panel.value)
            : (1 - panel.value) * (panelHeight.value + insets.bottom + 24) + drag.value,
      },
      { scale: reduced || !menu ? 1 : 0.94 + 0.06 * panel.value },
    ],
  }));
  const pan = Gesture.Pan()
    .activeOffsetY(6)
    .failOffsetX([-24, 24])
    .onUpdate((event) => {
      drag.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (event.translationY > Math.min(100, panelHeight.value * 0.22) || event.velocityY > 800) runOnJS(dismiss)();
      else drag.value = withSpring(0, { duration: reduced ? 0 : 230, dampingRatio: 1 });
    })
    .onFinalize((_event, success) => {
      if (!success) drag.value = withSpring(0, { duration: reduced ? 0 : 230, dampingRatio: 1 });
    });
  if (!mounted) return null;
  const menuTop = Math.min(anchor ? anchor.y + anchor.height + 8 : insets.top + 56, height - insets.bottom - 180);
  const menuRight = anchor ? Math.max(16, Math.min(width - 256, width - anchor.x - anchor.width)) : 16;
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onRequestClose}
    >
      <GestureHandlerRootView style={s.host}>
        <KeyboardProvider>
          <Animated.View style={[StyleSheet.absoluteFillObject, shade]}>
            {Platform.OS === 'ios' && !opaque && !menu && (
              <BlurView style={StyleSheet.absoluteFill} intensity={12} tint={p.mode === 'dark' ? 'dark' : 'light'} />
            )}
            <Pressable
              style={[
                StyleSheet.absoluteFillObject,
                { backgroundColor: p.mode === 'dark' ? 'rgba(0,0,0,0.40)' : 'rgba(15,23,42,0.28)' },
              ]}
              onPress={dismiss}
              accessibilityRole="button"
              accessibilityLabel={menu ? 'Закрыть меню журнала' : 'Закрыть фильтры'}
            />
          </Animated.View>
          <KeyboardAvoidingView behavior="padding" style={s.host} pointerEvents="box-none">
            <View
              style={[
                s.position,
                { paddingTop: insets.top + 8 },
                menu && { ...s.menuPosition, paddingTop: menuTop, paddingRight: menuRight },
              ]}
              pointerEvents="box-none"
            >
              <Animated.View
                testID="journal-modal-panel"
                accessibilityViewIsModal
                onAccessibilityEscape={onRequestClose}
                pointerEvents={visible ? 'auto' : 'none'}
                onLayout={(event) => {
                  panelHeight.value = event.nativeEvent.layout.height;
                }}
                style={[
                  s.panel,
                  {
                    backgroundColor: p.bg.elevated,
                    maxHeight: height - insets.top - 16,
                    paddingBottom: menu ? 4 : insets.bottom,
                    shadowColor: p.shadow.color,
                    shadowOpacity: p.mode === 'dark' ? 0.3 : 0.15,
                  },
                  menu && s.menu,
                  surface,
                ]}
              >
                {!menu && (
                  <GestureDetector gesture={pan}>
                    <View style={s.gripArea}>
                      <View style={[s.grip, { backgroundColor: p.border.strong }]} />
                    </View>
                  </GestureDetector>
                )}
                {children}
              </Animated.View>
            </View>
          </KeyboardAvoidingView>
        </KeyboardProvider>
      </GestureHandlerRootView>
    </Modal>
  );
}

/** Both pages coexist for the transition; only the current one receives input or accessibility focus. */
export function JournalFilterPage({ page, children }: { page: string; children: React.ReactNode }) {
  const reduced = useJournalReducedMotion();
  const { width } = useWindowDimensions();
  const [outgoing, setOutgoing] = useState<React.ReactNode>(null);
  const previous = useRef({ page, children });
  const generation = useRef(0);
  const progress = useSharedValue(1);
  const direction = useSharedValue(1);
  const contentHeight = useSharedValue(-1);
  const settle = (run: number) => {
    if (run === generation.current) setOutgoing(null);
  };
  useLayoutEffect(() => {
    if (page !== previous.current.page) {
      const run = ++generation.current;
      setOutgoing(previous.current.children);
      direction.value = page === 'overview' ? -1 : 1;
      cancelAnimation(progress);
      progress.value = 0;
      progress.value = withTiming(1, { duration: reduced ? 90 : 230, easing: Easing.out(Easing.cubic) }, (finished) => {
        if (finished) runOnJS(settle)(run);
      });
    }
    previous.current = { page, children };
  }, [page, children, reduced, progress, direction]);
  const incomingMotion = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateX: reduced ? 0 : direction.value * (1 - progress.value) * Math.min(100, width * 0.25) }],
  }));
  const outgoingMotion = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ translateX: reduced ? 0 : -direction.value * progress.value * Math.min(64, width * 0.16) }],
  }));
  // Only exchanging pages constrains height. Once settled, Yoga owns the
  // intrinsic height again, including a live Dynamic Type change.
  const heightMotion = useAnimatedStyle(() => ({
    height: progress.value < 1 && contentHeight.value >= 0 ? contentHeight.value : undefined,
  }));
  return (
    <Animated.View style={[s.page, heightMotion]}>
      {outgoing !== null && (
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[s.outgoing, outgoingMotion]}
        >
          {outgoing}
        </Animated.View>
      )}
      <Animated.View
        onLayout={(event) => {
          const next = event.nativeEvent.layout.height;
          contentHeight.value =
            contentHeight.value < 0 || reduced
              ? next
              : withTiming(next, { duration: 230, easing: Easing.out(Easing.cubic) });
        }}
        style={incomingMotion}
      >
        {children}
      </Animated.View>
    </Animated.View>
  );
}
const s = StyleSheet.create({
  host: { flex: 1 },
  position: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  panel: {
    width: '100%',
    maxWidth: 600,
    flexShrink: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderCurve: 'continuous',
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 22,
    elevation: 12,
  },
  menuPosition: { justifyContent: 'flex-start', alignItems: 'flex-end', paddingLeft: 16 },
  menu: {
    width: 240,
    maxWidth: '100%',
    borderRadius: 20,
    paddingTop: 4,
    shadowOffset: { width: 0, height: 8 },
    transformOrigin: 'top right',
  },
  gripArea: { height: 24, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 34, height: 4, borderRadius: 2 },
  page: { overflow: 'hidden' },
  outgoing: { position: 'absolute', left: 0, right: 0, top: 0 },
});
