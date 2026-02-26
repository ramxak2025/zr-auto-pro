import React from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { usersApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { User } from '../../../shared/types';

const roleLabels: Record<string, string> = { superadmin: 'Суперадмин', director: 'Владелец', admin: 'Администратор', master: 'Мастер' };
const roleBadgeColors: Record<string, { bg: string; text: string }> = {
  director: { bg: colors.purple[50], text: colors.purple[700] },
  admin: { bg: colors.blue[50], text: colors.blue[700] },
  master: { bg: colors.green[50], text: colors.green[700] },
};

export default function UsersScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: users, isLoading } = useQuery<User[]>({
    queryKey: ['users'],
    queryFn: async () => { const res = await usersApi.getAll(); return res.data; },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['users'] });
    setRefreshing(false);
  };

  const renderUser = ({ item }: { item: User }) => {
    const badge = roleBadgeColors[item.role] || { bg: colors.gray[100], text: colors.gray[600] };
    return (
      <View style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{item.fullName?.charAt(0) || 'U'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{item.fullName}</Text>
            <Text style={styles.userPhone}>{item.phone}</Text>
          </View>
          <View style={[styles.roleBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.roleBadgeText, { color: badge.text }]}>{roleLabels[item.role] || item.role}</Text>
          </View>
        </View>
        <View style={styles.userMeta}>
          {item.salaryPercent > 0 && <Text style={styles.metaText}>Услуги {item.salaryPercent}%</Text>}
          {item.productSalaryPercent ? <Text style={styles.metaText}>Товары {item.productSalaryPercent}%</Text> : null}
          {!item.isActive && <Text style={[styles.metaText, { color: colors.red[500] }]}>Неактивен</Text>}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Пользователи</Text>
        <View style={{ width: 60 }} />
      </View>

      {isLoading ? <LoadingSpinner /> : !users?.length ? (
        <EmptyState title="Нет пользователей" />
      ) : (
        <FlatList data={users} keyExtractor={i => i.id} renderItem={renderUser} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[3], paddingTop: spacing[3] },
  card: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary[100], alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.primary[700] },
  userName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  userPhone: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  roleBadge: { paddingHorizontal: spacing[2.5], paddingVertical: 3, borderRadius: borderRadius.full },
  roleBadgeText: { fontSize: 11, fontWeight: fontWeight.medium },
  userMeta: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[50] },
  metaText: { fontSize: fontSize.xs, color: colors.gray[400] },
});
