import React, { forwardRef, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../contexts/ThemeContext';
import { Text, textVariantStyles } from '../platform/Typography';

export const headerTouchSize = Platform.OS === 'android' ? 48 : 44;

/** A functional island with the established warehouse material. No empty decorative shell. */
export function HeaderIsland({
  children,
  style,
  layout = 'row',
  testID,
}: {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  layout?: 'row' | 'column';
  testID?: string;
}) {
  const p = useColors();
  if (React.Children.toArray(children).length === 0) return null;
  return (
    <View
      testID={testID}
      style={[
        s.island,
        layout === 'column' && s.column,
        { backgroundColor: p.bg.elevated, shadowColor: p.shadow.color, shadowOpacity: p.mode === 'dark' ? 0.24 : 0.09 },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export type HeaderActionProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title?: string;
  tone?: 'default' | 'primary';
  loading?: boolean;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function HeaderAction({
  label,
  icon,
  title,
  tone = 'default',
  loading = false,
  disabled,
  accessibilityState,
  children,
  style,
  ...props
}: HeaderActionProps) {
  const p = useColors();
  const unavailable = Boolean(disabled || loading);
  const color = tone === 'primary' ? p.text.inverse : p.accent.primaryText;
  return (
    <Pressable
      {...props}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ ...accessibilityState, disabled: unavailable, busy: loading }}
      disabled={unavailable}
      style={({ pressed }) => [
        s.action,
        !!title && s.textAction,
        tone === 'primary' && { backgroundColor: p.accent.primary },
        { opacity: unavailable ? 0.45 : pressed ? 0.72 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : icon ? (
        <Ionicons name={icon} size={22} color={color} />
      ) : null}
      {!!title && (
        <Text variant="bodyEmph" color={color}>
          {title}
        </Text>
      )}
      {children}
    </Pressable>
  );
}

export type HeaderSearchProps = {
  value: string;
  onChange: (value: string) => void;
  /** The caller owns search semantics. Cashier/plate search must choose immediate explicitly. */
  timing: 'immediate' | { debounceMs: number };
  placeholder?: string;
  active?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onCancel?: () => void;
  showCancel?: boolean;
  /** Opt-in for an authored reveal. An always-visible search never grabs focus by default. */
  focusWhenActive?: boolean;
  focusOnClear?: boolean;
  dismissOnSubmit?: boolean;
  nativeProps?: Omit<TextInputProps, 'value' | 'onChangeText'>;
  style?: StyleProp<ViewStyle>;
};

/** One native input: presentation never owns filters, routes, permissions or reveal state. */
export const HeaderSearch = forwardRef<TextInput, HeaderSearchProps>(function HeaderSearch(
  {
    value,
    onChange,
    timing,
    placeholder = 'Поиск',
    active = true,
    onFocusChange,
    onCancel,
    showCancel = Boolean(onCancel),
    focusWhenActive = false,
    focusOnClear = true,
    dismissOnSubmit = false,
    nativeProps,
    style,
  },
  ref,
) {
  const p = useColors();
  const [local, setLocal] = useState(value);
  const field = useRef<TextInput | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => {
    if (!focusWhenActive) return;
    if (active) field.current?.focus();
    else field.current?.blur();
  }, [active, focusWhenActive]);
  useEffect(() => {
    clearTimer();
    setLocal((previous) => (previous === value ? previous : value));
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const editable = active && nativeProps?.editable !== false;
  return (
    <View
      style={[s.searchRow, style]}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      <View style={[s.search, { backgroundColor: p.bg.muted }]}>
        <Ionicons name="search" size={19} color={p.text.secondary} />
        <TextInput
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityRole="search"
          accessibilityLabel={placeholder}
          placeholder={placeholder}
          placeholderTextColor={p.text.secondary}
          selectionColor={p.accent.primary}
          {...nativeProps}
          ref={(instance) => {
            field.current = instance;
            if (typeof ref === 'function') ref(instance);
            else if (ref) ref.current = instance;
          }}
          value={local}
          editable={editable}
          style={[textVariantStyles.body, s.field, { color: p.text.primary }, nativeProps?.style]}
          onChangeText={(next) => {
            setLocal(next);
            clearTimer();
            if (timing === 'immediate' || timing.debounceMs <= 0) onChange(next);
            else
              timer.current = setTimeout(() => {
                timer.current = null;
                onChange(next);
              }, timing.debounceMs);
          }}
          onSubmitEditing={(event) => {
            if (timer.current !== null) {
              clearTimer();
              onChange(local);
            }
            nativeProps?.onSubmitEditing?.(event);
            if (dismissOnSubmit) Keyboard.dismiss();
          }}
          onFocus={(event) => {
            nativeProps?.onFocus?.(event);
            onFocusChange?.(true);
          }}
          onBlur={(event) => {
            nativeProps?.onBlur?.(event);
            onFocusChange?.(false);
          }}
        />
        {!!local && editable && (
          <Pressable
            style={s.action}
            accessibilityRole="button"
            accessibilityLabel="Очистить поиск"
            onPress={() => {
              clearTimer();
              setLocal('');
              onChange('');
              if (focusOnClear) field.current?.focus();
            }}
          >
            <Ionicons name="close-circle" size={19} color={p.text.secondary} />
          </Pressable>
        )}
      </View>
      {showCancel && (
        <Pressable
          style={s.cancel}
          accessibilityRole="button"
          accessibilityLabel="Отменить поиск"
          onPress={() => {
            clearTimer();
            setLocal('');
            onChange('');
            field.current?.blur();
            Keyboard.dismiss();
            onFocusChange?.(false);
            onCancel?.();
          }}
        >
          <Text variant="footnote" color={p.accent.primaryText}>
            Отмена
          </Text>
        </Pressable>
      )}
    </View>
  );
});

const s = StyleSheet.create({
  island: {
    borderRadius: 28,
    borderCurve: 'continuous',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 18,
    elevation: 5,
    padding: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  column: { flexDirection: 'column', alignItems: 'stretch' },
  action: {
    minWidth: headerTouchSize,
    minHeight: headerTouchSize,
    borderRadius: headerTouchSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  textAction: { paddingHorizontal: 14, paddingVertical: 8, flexShrink: 1 },
  searchRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: {
    flex: 1,
    minWidth: 0,
    minHeight: headerTouchSize,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 12,
    gap: 8,
  },
  field: { flex: 1, minWidth: 0, minHeight: headerTouchSize, paddingVertical: 8, paddingRight: 4 },
  cancel: { minHeight: headerTouchSize, justifyContent: 'center', paddingRight: 6 },
});
