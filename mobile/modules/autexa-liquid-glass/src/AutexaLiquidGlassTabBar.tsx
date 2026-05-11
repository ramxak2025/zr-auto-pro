import * as React from 'react';
import { Platform, View, NativeSyntheticEvent } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';
import { BlurView } from 'expo-blur';

export interface AutexaLiquidGlassTabBarProps {
  tabCount: number;
  activeIndex: number;
  bottomInset?: number;
  onTabPress?: (index: number) => void;
  style?: any;
  children?: React.ReactNode;
}

let NativeTabBar: React.ComponentType<any> | null = null;
try {
  // Same module name as the View definition in AutexaLiquidGlassModule.swift
  // ExpoModulesCore registers a separate native component per `View()` block
  // by class name; the name here is the View class.
  NativeTabBar = requireNativeViewManager('AutexaLiquidGlassTabBar');
} catch {
  NativeTabBar = null;
}

/**
 * AutexaLiquidGlassTabBar — JS bridge to the native bar with the
 * "droplet" indicator. iOS-only; on Android we fall back to a plain
 * surface (the existing TabBar.android.tsx is used in practice, this is
 * just a defensive runtime fallback).
 */
export function AutexaLiquidGlassTabBar(props: AutexaLiquidGlassTabBarProps) {
  const { tabCount, activeIndex, bottomInset = 0, onTabPress, style, children } = props;

  const handleEvent = React.useCallback(
    (e: NativeSyntheticEvent<{ index: number }>) => {
      onTabPress?.(e.nativeEvent.index);
    },
    [onTabPress],
  );

  if (Platform.OS === 'ios' && NativeTabBar) {
    return (
      <NativeTabBar
        tabCount={tabCount}
        activeIndex={activeIndex}
        bottomInset={bottomInset}
        onTabPress={handleEvent}
        style={style}
      >
        {children}
      </NativeTabBar>
    );
  }

  // Fallback: BlurView (still native UIVisualEffectView) without droplet animation.
  return (
    <BlurView tint="systemThinMaterialLight" intensity={92} style={style}>
      {children}
    </BlurView>
  );
}
