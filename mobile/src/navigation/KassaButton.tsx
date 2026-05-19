/**
 * KassaButton — liquid-glass plasma center button.
 *
 * Exactly the visual from the original AppNavigator, extracted so both
 * TabBar.ios.tsx and TabBar.android.tsx can share it. Uses the legacy
 * Animated API (not Reanimated) because the effect consists of dozens of
 * interpolated nodes and the legacy driver's native-side batching is
 * actually faster for this case.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { colors } from '../theme';

const KASSA_SIZE = 62;

export function KassaButton() {
  const wave1 = useRef(new Animated.Value(0)).current;
  const wave2 = useRef(new Animated.Value(0)).current;
  const wave3 = useRef(new Animated.Value(0)).current;
  const rotate = useRef(new Animated.Value(0)).current;
  const rotate2 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(wave1, { toValue: 1, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(wave1, { toValue: 0, duration: 2400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(wave2, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(wave2, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.sequence([
      Animated.timing(wave3, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(wave3, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ])).start();
    Animated.loop(Animated.timing(rotate, { toValue: 1, duration: 10000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.loop(Animated.timing(rotate2, { toValue: 1, duration: 7000, easing: Easing.linear, useNativeDriver: true })).start();
  }, [wave1, wave2, wave3, rotate, rotate2]);

  const rotateVal = rotate.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const rotateVal2 = rotate2.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] });

  return (
    <View style={s.outer}>
      <View style={s.body}>
        <LinearGradient
          colors={[colors.primary[400], colors.primary[600], colors.primary[800]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View style={[s.liquidContainer, { transform: [{ rotate: rotateVal }] }]}>
          <Animated.View style={[s.liquidBlob, {
            top: -8, left: -4, width: 50, height: 50, borderRadius: 25,
            backgroundColor: 'rgba(147, 197, 253, 0.35)',
            opacity: wave1.interpolate({ inputRange: [0, 1], outputRange: [0.2, 0.45] }),
            transform: [
              { scale: wave1.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.8, 1.2, 0.8] }) },
              { translateX: wave2.interpolate({ inputRange: [0, 1], outputRange: [-3, 5] }) },
            ],
          }]} />
          <Animated.View style={[s.liquidBlob, {
            bottom: -6, right: -6, width: 40, height: 40, borderRadius: 20,
            backgroundColor: 'rgba(96, 165, 250, 0.3)',
            opacity: wave2.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.4] }),
            transform: [
              { scale: wave2.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1.1, 0.7, 1.1] }) },
            ],
          }]} />
        </Animated.View>

        <Animated.View style={[s.liquidContainer, { transform: [{ rotate: rotateVal2 }] }]}>
          <Animated.View style={[s.liquidBlob, {
            top: 10, right: -2, width: 35, height: 35, borderRadius: 18,
            backgroundColor: 'rgba(191, 219, 254, 0.3)',
            opacity: wave3.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.35] }),
            transform: [
              { scale: wave3.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.9, 1.3, 0.9] }) },
            ],
          }]} />
        </Animated.View>

        <Animated.View style={[s.glassHighlight, {
          opacity: wave1.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.12, 0.25, 0.12] }),
        }]} />
        <Animated.View style={[s.bottomLight, {
          opacity: wave3.interpolate({ inputRange: [0, 1], outputRange: [0.05, 0.15] }),
        }]} />

        <Ionicons name="receipt-outline" size={26} color={colors.white} style={{ zIndex: 5 }} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  outer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: KASSA_SIZE + 4,
    height: KASSA_SIZE + 4,
    // iOS: pop the button up out of the slim 60pt floating bar so it
    // reads as a central FAB-style CTA.
    // Android: M3 NavigationBar is 80pt tall — keep the button inside
    // the bar so the surface remains a clean 80pt rectangle (no FAB
    // cut-out), which is the M3-compatible way to render a strongly
    // branded center action.
    marginTop: Platform.OS === 'ios' ? -28 : 0,
  },
  body: {
    width: KASSA_SIZE,
    height: KASSA_SIZE,
    borderRadius: KASSA_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 12,
    shadowColor: colors.primary[700],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(191, 219, 254, 0.4)',
  },
  liquidContainer: { ...StyleSheet.absoluteFillObject },
  liquidBlob: { position: 'absolute' },
  glassHighlight: {
    position: 'absolute',
    top: -KASSA_SIZE * 0.15,
    left: -KASSA_SIZE * 0.1,
    width: KASSA_SIZE * 0.65,
    height: KASSA_SIZE * 0.45,
    borderRadius: KASSA_SIZE * 0.3,
    backgroundColor: 'rgba(255,255,255,0.25)',
    zIndex: 3,
  },
  bottomLight: {
    position: 'absolute',
    bottom: 2,
    right: 4,
    width: KASSA_SIZE * 0.35,
    height: KASSA_SIZE * 0.2,
    borderRadius: KASSA_SIZE * 0.15,
    backgroundColor: 'rgba(147, 197, 253, 0.2)',
    zIndex: 2,
  },
});
