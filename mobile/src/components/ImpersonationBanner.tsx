/**
 * ImpersonationBanner — persistent strip shown while a superadmin is logged in
 * as a tenant owner (via tenantsApi.impersonate → AuthContext.beginImpersonation).
 *
 * Sits at the very top of the authenticated tree (over the car-service shell)
 * so the operator always knows they're inside someone else's account, with a
 * one-tap «Выйти» that ends impersonation (a hard logout — the 30-min director
 * token has no superadmin creds to restore, so the superadmin signs back in).
 *
 * Renders nothing when not impersonating, so it's a zero-cost no-op for every
 * normal session.
 */
import React from 'react';
import { View, StyleSheet, Pressable, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing } from '../theme';

export default function ImpersonationBanner() {
  const { isImpersonating, user, endImpersonation } = useAuth();
  const insets = useSafeAreaInsets();

  if (!isImpersonating) return null;

  const onExit = () => {
    haptic('warning');
    Alert.alert('Выйти из аккаунта владельца?', 'Вы вернётесь на экран входа и сможете снова войти под суперадмином.', [
      { text: 'Остаться', style: 'cancel' },
      { text: 'Выйти', style: 'destructive', onPress: () => endImpersonation() },
    ]);
  };

  return (
    <View style={[styles.banner, { paddingTop: insets.top + spacing[1.5] }]}>
      <Ionicons name="eye" size={15} color={colors.white} />
      <Text style={styles.text} numberOfLines={1}>
        Вы вошли как {user?.fullName ?? 'владелец'}
      </Text>
      <Pressable onPress={onExit} hitSlop={8} style={styles.exitBtn}>
        <Text style={styles.exitText}>Выйти</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
    backgroundColor: colors.amber[600],
  },
  text: { flex: 1, color: colors.white, fontSize: 13, fontWeight: '700' },
  exitBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  exitText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
