import React, { useEffect, useRef, ReactNode } from 'react';
import { Animated, Easing, StyleSheet, ViewStyle } from 'react-native';

interface AnimatedScreenProps {
  children: ReactNode;
  style?: ViewStyle;
  delay?: number;
}

export default function AnimatedScreen({ children, style, delay = 0 }: AnimatedScreenProps) {
  // Calm fade-in only — no Y-translation bounce. Premium iOS-style
  // screens shouldn't "slide up" on every mount; that reads as
  // springy. Sub-200ms ease-out feels like the screen just appears.
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 200,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View
      style={[
        styles.container,
        style,
        {
          opacity: fadeAnim,
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
