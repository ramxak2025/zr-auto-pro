import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Cloud, Frown } from 'lucide-react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

function RainDrop({ index }: { index: number }) {
  const fall = useSharedValue(0);
  useEffect(() => {
    fall.value = withDelay(index * 130, withTiming(1, { duration: 1200 }));
    return () => cancelAnimation(fall);
  }, [fall, index]);
  const motion = useAnimatedStyle(() => ({
    opacity: Math.sin(fall.value * Math.PI) * 0.7,
    transform: [{ translateY: fall.value * 66 }],
  }));
  return <Animated.View style={[styles.drop, { left: 16 + index * 22 }, motion]} />;
}

/** A quiet cloud, falling rain and a sad face. No confetti, bounce or success cue. */
export function SalaryFineIllustration({ reducedMotion }: { reducedMotion: boolean }) {
  const tilt = useSharedValue(0);
  useEffect(() => {
    tilt.value = reducedMotion
      ? 0
      : withSequence(withTiming(-0.08, { duration: 500 }), withTiming(0, { duration: 900 }));
    return () => cancelAnimation(tilt);
  }, [reducedMotion, tilt]);
  const motion = useAnimatedStyle(() => ({
    transform: [{ rotate: `${tilt.value}rad` }, { translateY: -tilt.value * 55 }],
  }));
  return (
    <View
      style={styles.host}
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {!reducedMotion && Array.from({ length: 5 }, (_, index) => <RainDrop key={index} index={index} />)}
      <Cloud size={48} color="#94a3b8" fill="#475569" style={styles.cloud} />
      <Animated.View style={[styles.face, motion]}>
        <Frown size={62} color="#fecaca" strokeWidth={1.5} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { width: 136, height: 144, alignItems: 'center', marginBottom: 8 },
  cloud: { position: 'absolute', top: 0 },
  drop: { position: 'absolute', top: 34, width: 3, height: 10, borderRadius: 2, backgroundColor: '#94a3b8' },
  face: {
    position: 'absolute',
    bottom: 0,
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
