import React from 'react';
import { View, Pressable, RefreshControl, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../../platform/Typography';
import { Icon, type IconName } from '../../platform/Icon';
import IosScreenHeader from '../../components/IosScreenHeader';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { KeyboardAwareScroll } from '../../components/KeyboardAware';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
export function AdminPage({
  title,
  subtitle,
  back,
  trailing,
  refreshing = false,
  onRefresh,
  children,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  trailing?: React.ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  const palette = useColors(),
    navigation = useNavigation();
  const { contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={back ? () => navigation.goBack() : undefined}
        trailing={trailing}
      />
      <KeyboardAwareScroll
        extraKeyboardBottomOffset={16}
        contentContainerStyle={[styles.content, { paddingBottom: contentContainerPaddingBottom }]}
        refreshControl={
          onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
          ) : undefined
        }
      >
        {children}
      </KeyboardAwareScroll>
    </View>
  );
}
export function AdminGroup({ children }: { children: React.ReactNode }) {
  const surface = useIosSurface();
  return <View style={[surface.cardCompact, styles.group]}>{children}</View>;
}
export function AdminHeading({ children }: { children: React.ReactNode }) {
  const palette = useColors();
  return (
    <Text variant="title3" color={palette.text.primary} style={styles.heading}>
      {children}
    </Text>
  );
}
export function AdminRow({
  label,
  value,
  detail,
  onPress,
  icon,
  trailing,
}: {
  label: string;
  value?: string;
  detail?: string;
  onPress?: () => void;
  icon?: IconName;
  trailing?: React.ReactNode;
}) {
  const p = useColors();
  const content = (
    <>
      {icon ? <Icon name={icon} size={21} color={p.accent.primary} /> : null}
      <View style={styles.rowContent}>
        <Text color={p.text.primary}>{label}</Text>
        {detail ? (
          <Text variant="footnote" color={p.text.secondary}>
            {detail}
          </Text>
        ) : null}
      </View>
      {value !== undefined ? (
        <Text variant="bodyEmph" color={p.text.primary} style={styles.rowValue}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {onPress ? <Icon name="chevron-right" size={16} color={p.text.tertiary} /> : null}
    </>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.row, { borderBottomColor: p.border.subtle }]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={[styles.row, { borderBottomColor: p.border.subtle }]}>{content}</View>
  );
}
export function AdminAmount({ label, value, detail }: { label: string; value: string; detail?: string }) {
  const p = useColors();
  return (
    <View style={styles.amount}>
      <Text variant="body" color={p.text.secondary}>
        {label}
      </Text>
      <Text
        variant="display"
        color={p.text.primary}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={styles.amountValue}
      >
        {value}
      </Text>
      {detail ? (
        <Text variant="footnote" color={p.text.secondary}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}
export function AdminState({
  loading,
  error,
  empty,
  onRetry,
}: {
  loading?: boolean;
  error?: boolean;
  empty?: string;
  onRetry?: () => void;
}) {
  const p = useColors();
  if (loading)
    return (
      <View accessibilityLabel="Загрузка данных" style={styles.loading}>
        {[80, 100, 65].map((width) => (
          <View key={width} style={[styles.skeleton, { width: `${width}%`, backgroundColor: p.bg.muted }]} />
        ))}
      </View>
    );
  if (error)
    return (
      <AdminGroup>
        <AdminRow
          label="Не удалось загрузить данные"
          detail="Проверьте соединение и повторите запрос"
          icon="warning"
          onPress={onRetry}
        />
        <AdminAction label="Повторить" onPress={onRetry ?? (() => {})} />
      </AdminGroup>
    );
  return empty ? (
    <Text color={p.text.secondary} style={styles.empty}>
      {empty}
    </Text>
  ) : null;
}
export function AdminAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const p = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.action, { opacity: disabled ? 0.45 : 1 }]}
    >
      <Text variant="callout" color={p.accent.primary}>
        {label}
      </Text>
    </Pressable>
  );
}
export const adminUIStyles = StyleSheet.create({
  input: { minHeight: 48, padding: 12, borderRadius: 12, fontSize: 16 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 12 },
  group: { paddingVertical: 0, shadowOpacity: 0, elevation: 0 },
  heading: { marginTop: 12, marginBottom: 0 },
  row: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowContent: { flex: 1, minWidth: 120, gap: 3 },
  rowValue: { flexShrink: 1, maxWidth: '100%', fontVariant: ['tabular-nums'] },
  amount: { paddingVertical: 14, gap: 6 },
  amountValue: { width: '100%', fontVariant: ['tabular-nums'] },
  empty: { paddingVertical: 18 },
  action: { minHeight: 48, alignItems: 'center', justifyContent: 'center', padding: 10 },
  loading: { gap: 14, paddingVertical: 18 },
  skeleton: { height: 22, borderRadius: 6 },
});
