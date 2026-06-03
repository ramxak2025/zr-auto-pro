/**
 * KnowledgeBaseScreen — placeholder (#17).
 *
 * "База знаний" is a brand-new section requested by the owner. The real
 * content (учебный центр, регламенты, база знаний с поиском) is not built
 * yet, so this screen ships as a friendly, on-brand "coming soon" stub:
 *
 *   • Shared IosScreenHeader with a back chevron (it lives inside the
 *     MoreStack, so goBack() returns to MoreHome).
 *   • EmptyState (already bounce-free — Reanimated FadeInDown only) with a
 *     relevant icon and an encouraging message.
 *
 * Layout respects useTabBarHeight() for bottom padding and the top safe
 * area via SafeAreaView edges={['top']}. Fully Android-safe — uses only
 * shared, platform-agnostic components.
 */
import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';

export default function KnowledgeBaseScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();

  return (
    <SafeAreaView edges={['top']} style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="База знаний" onBack={() => navigation.goBack()} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.centerWrap}>
          <EmptyState
            icon="journal"
            title="Скоро здесь будет база знаний"
            description="Учебный центр, регламенты автосервиса и база знаний с быстрым поиском — всё в одном месте. Готовим раздел."
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1 },
  centerWrap: { flex: 1, justifyContent: 'center' },
});
