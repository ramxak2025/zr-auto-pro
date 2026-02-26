import React, { useEffect, useRef, ReactNode } from 'react';
import { Animated, TouchableOpacity, ViewStyle } from 'react-native';

interface AnimatedCardProps {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  index?: number;
  onPress?: () => void;
  activeOpacity?: number;
}

export default function AnimatedCard({ children, style, index = 0, onPress, activeOpacity = 0.7 }: AnimatedCardProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;
  const scaleAnim = useRef(new Animated.Value(0.96)).current;

  useEffect(() => {
    const delay = Math.min(index * 60, 300);
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 350,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 350,
        delay,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        friction: 8,
        tension: 40,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const animatedStyle = {
    opacity: fadeAnim,
    transform: [
      { translateY: slideAnim },
      { scale: scaleAnim },
    ],
  };

  if (onPress) {
    return (
      <Animated.View style={animatedStyle}>
        <TouchableOpacity style={style} onPress={onPress} activeOpacity={activeOpacity}>
          {children}
        </TouchableOpacity>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[animatedStyle, style]}>
      {children}
    </Animated.View>
  );
}
