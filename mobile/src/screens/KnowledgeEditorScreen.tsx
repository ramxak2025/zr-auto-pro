/**
 * KnowledgeEditorScreen — create / edit a Knowledge Base article (manager only).
 *
 * Route params:
 *   • {}        — create new
 *   • { id }    — edit existing (prefills from getArticle)
 *
 * Fields: title, category picker, type toggle (Статья / Регламент), markdown
 * body (plain multiline — markdown is just text), pinned toggle, published
 * toggle, cover image + attachments (via uploadsApi.upload → stored URL).
 *
 * Also supports minimal category management: an «+ Категория» inline add.
 *
 * Markdown is authored as raw text here; the reader renders it. We keep the
 * editor deliberately simple — no live preview — because that's what the owner
 * needs and it keeps the screen fast and predictable.
 */
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import CachedImage from '../components/CachedImage';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { knowledgeApi, uploadsApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { spacing, borderRadius, colors } from '../theme';
import { haptic } from '../platform/haptics';
import type {
  KnowledgeArticle,
  KnowledgeArticleType,
  KnowledgeAttachment,
  KnowledgeCategory,
} from '../../../shared/types';

type ParamList = { KnowledgeEditor: { id?: string } };

export default function KnowledgeEditorScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ParamList, 'KnowledgeEditor'>>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();

  const editId = route.params?.id;
  const isEdit = !!editId;

  // ── Form state ────────────────────────────────────────────────────────
  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [type, setType] = React.useState<KnowledgeArticleType>('article');
  const [categoryId, setCategoryId] = React.useState<string | null>(null);
  const [coverImage, setCoverImage] = React.useState<string | null>(null);
  const [attachments, setAttachments] = React.useState<KnowledgeAttachment[]>([]);
  const [pinned, setPinned] = React.useState(false);
  const [published, setPublished] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  // ── Categories ────────────────────────────────────────────────────────
  const { data: categories } = useQuery<KnowledgeCategory[]>({
    queryKey: ['knowledge-categories'],
    queryFn: async () => (await knowledgeApi.listCategories()).data,
    staleTime: 5 * 60_000,
  });

  // ── Load existing (edit) ──────────────────────────────────────────────
  const { data: existing, isLoading: loadingExisting } = useQuery<KnowledgeArticle>({
    queryKey: ['knowledge-article', editId],
    queryFn: async () => (await knowledgeApi.getArticle(editId as string)).data,
    enabled: isEdit,
    staleTime: 30_000,
  });

  React.useEffect(() => {
    if (existing && !hydrated) {
      setTitle(existing.title);
      setBody(existing.body ?? '');
      setType(existing.type);
      setCategoryId(existing.categoryId ?? null);
      setCoverImage(existing.coverImage ?? null);
      setAttachments(existing.attachments ?? []);
      setPinned(existing.pinned);
      setPublished(existing.published);
      setHydrated(true);
    }
  }, [existing, hydrated]);

  // ── Save ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: title.trim(),
        body,
        type,
        categoryId,
        coverImage,
        attachments,
        pinned,
        published,
      };
      if (isEdit) {
        return (await knowledgeApi.updateArticle(editId as string, payload)).data;
      }
      return (await knowledgeApi.createArticle(payload)).data;
    },
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['knowledge-articles'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-regulations-pending'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['knowledge-article', editId] });
      navigation.goBack();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить. Попробуйте ещё раз.');
    },
  });

  const onSave = () => {
    if (!title.trim()) {
      Alert.alert('Заголовок обязателен', 'Введите название статьи.');
      return;
    }
    haptic('tap');
    saveMutation.mutate();
  };

  // ── Uploads ───────────────────────────────────────────────────────────
  const pickCover = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      setUploading(true);
      const up = await uploadsApi.upload(asset.uri, asset.fileName || 'cover.jpg');
      setCoverImage(up.data.url);
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить обложку.');
    } finally {
      setUploading(false);
    }
  };

  const addAttachment = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.85,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      setUploading(true);
      const up = await uploadsApi.upload(asset.uri, asset.fileName || 'attachment.jpg');
      setAttachments((prev) => [
        ...prev,
        { url: up.data.url, name: up.data.originalname || asset.fileName || 'Вложение', size: up.data.size },
      ]);
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить вложение.');
    } finally {
      setUploading(false);
    }
  };

  // ── New category (minimal management) ─────────────────────────────────
  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => (await knowledgeApi.createCategory({ name })).data,
    onSuccess: (cat) => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['knowledge-categories'] });
      setCategoryId(cat.id);
    },
  });

  const promptNewCategory = () => {
    haptic('tap');
    Alert.prompt?.(
      'Новая категория',
      'Название категории',
      (text?: string) => {
        const name = (text ?? '').trim();
        if (name) createCategoryMutation.mutate(name);
      },
      'plain-text',
    );
  };

  const inputBg = palette.bg.card;
  const inputBorder = palette.border.subtle;

  if (isEdit && loadingExisting && !existing) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Редактирование" onBack={() => navigation.goBack()} />
        <LoadingSpinner />
      </View>
    );
  }

  const saveTrailing = (
    <Pressable
      onPress={onSave}
      disabled={saveMutation.isPending}
      hitSlop={10}
      style={[styles.saveBtn, { backgroundColor: palette.accent.primary, opacity: saveMutation.isPending ? 0.6 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel="Сохранить"
    >
      <Text variant="footnote" color={colors.white} style={{ fontWeight: '700' }}>
        {saveMutation.isPending ? '…' : 'Готово'}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={isEdit ? 'Редактирование' : 'Новая статья'}
        onBack={() => navigation.goBack()}
        trailing={saveTrailing}
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing[8] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Cover */}
        <Pressable
          onPress={pickCover}
          disabled={uploading}
          style={[styles.coverPick, { backgroundColor: palette.bg.muted, borderColor: inputBorder }]}
        >
          {coverImage ? (
            <CachedImage source={{ uri: getImageUrl(coverImage) }} style={styles.coverImg} resizeMode="cover" />
          ) : (
            <View style={styles.coverEmpty}>
              <Ionicons name="image-outline" size={26} color={palette.text.tertiary} />
              <Text variant="footnote" style={{ color: palette.text.tertiary }}>
                {uploading ? 'Загрузка…' : 'Добавить обложку'}
              </Text>
            </View>
          )}
          {coverImage ? (
            <Pressable
              onPress={() => setCoverImage(null)}
              hitSlop={8}
              style={[styles.coverRemove, { backgroundColor: 'rgba(0,0,0,0.55)' }]}
            >
              <Ionicons name="close" size={16} color={colors.white} />
            </Pressable>
          ) : null}
        </Pressable>

        {/* Title */}
        <Text style={[iosSectionLabel, styles.label, { color: palette.text.secondary }]}>Заголовок</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Название статьи"
          placeholderTextColor={palette.text.tertiary}
          style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary }]}
        />

        {/* Type toggle */}
        <Text style={[iosSectionLabel, styles.label, { color: palette.text.secondary }]}>Тип</Text>
        <View style={[styles.segment, { backgroundColor: palette.bg.muted }]}>
          {(['article', 'regulation'] as KnowledgeArticleType[]).map((t) => {
            const active = type === t;
            return (
              <Pressable
                key={t}
                onPress={() => {
                  haptic('select');
                  setType(t);
                }}
                style={[styles.segmentItem, active && { backgroundColor: palette.bg.card }]}
              >
                <Text
                  variant="bodyEmph"
                  style={{ color: active ? palette.text.primary : palette.text.secondary }}
                >
                  {t === 'article' ? 'Статья' : 'Регламент'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Category */}
        <View style={styles.catHeader}>
          <Text style={[iosSectionLabel, styles.labelInline, { color: palette.text.secondary }]}>Категория</Text>
          <Pressable onPress={promptNewCategory} hitSlop={8} style={styles.addCatBtn}>
            <Ionicons name="add" size={16} color={palette.accent.primary} />
            <Text variant="footnote" style={{ color: palette.accent.primary, fontWeight: '600' }}>
              Категория
            </Text>
          </Pressable>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catChips}>
          <CategoryChip
            label="Без категории"
            active={categoryId === null}
            onPress={() => setCategoryId(null)}
            palette={palette}
          />
          {(categories ?? []).map((c) => (
            <CategoryChip
              key={c.id}
              label={c.name}
              active={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
              palette={palette}
            />
          ))}
        </ScrollView>

        {/* Body */}
        <Text style={[iosSectionLabel, styles.label, { color: palette.text.secondary }]}>
          Текст (Markdown)
        </Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={'# Заголовок\n\nТекст с **жирным**, *курсивом*, списками:\n- пункт\n- пункт'}
          placeholderTextColor={palette.text.tertiary}
          multiline
          textAlignVertical="top"
          style={[
            styles.input,
            styles.bodyInput,
            { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary },
          ]}
        />

        {/* Attachments */}
        <View style={styles.catHeader}>
          <Text style={[iosSectionLabel, styles.labelInline, { color: palette.text.secondary }]}>Вложения</Text>
          <Pressable onPress={addAttachment} hitSlop={8} style={styles.addCatBtn} disabled={uploading}>
            <Ionicons name="add" size={16} color={palette.accent.primary} />
            <Text variant="footnote" style={{ color: palette.accent.primary, fontWeight: '600' }}>
              Добавить
            </Text>
          </Pressable>
        </View>
        <View style={{ gap: spacing[2] }}>
          {attachments.map((att, i) => (
            <View
              key={`${att.url}-${i}`}
              style={[styles.attachRow, { backgroundColor: inputBg, borderColor: inputBorder }]}
            >
              <Ionicons name="document-attach-outline" size={18} color={palette.text.secondary} />
              <Text variant="bodyEmph" numberOfLines={1} style={{ flex: 1, color: palette.text.primary }}>
                {att.name}
              </Text>
              <Pressable onPress={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color={colors.red[500]} />
              </Pressable>
            </View>
          ))}
          {attachments.length === 0 ? (
            <Text variant="footnote" style={{ color: palette.text.tertiary }}>
              Вложений нет.
            </Text>
          ) : null}
        </View>

        {/* Toggles */}
        <View style={[styles.toggleCard, { backgroundColor: inputBg, borderColor: inputBorder }]}>
          <ToggleRow
            label="Закрепить"
            hint="Показывать в «Закреплённых» на главной"
            value={pinned}
            onValueChange={setPinned}
            palette={palette}
            divider
          />
          <ToggleRow
            label="Опубликовано"
            hint="Видно сотрудникам"
            value={published}
            onValueChange={setPublished}
            palette={palette}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function CategoryChip({
  label,
  active,
  onPress,
  palette,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={() => {
        haptic('select');
        onPress();
      }}
      style={[
        styles.catChip,
        {
          backgroundColor: active ? palette.accent.primary : palette.bg.card,
          borderColor: active ? palette.accent.primary : palette.border.subtle,
        },
      ]}
    >
      <Text variant="footnote" style={{ color: active ? colors.white : palette.text.secondary, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
  palette,
  divider,
}: {
  label: string;
  hint: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  palette: ReturnType<typeof useColors>;
  divider?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, divider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border.subtle }]}>
      <View style={{ flex: 1 }}>
        <Text variant="bodyEmph" style={{ color: palette.text.primary }}>
          {label}
        </Text>
        <Text variant="caption" style={{ color: palette.text.tertiary }}>
          {hint}
        </Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },

  saveBtn: {
    height: 32,
    minWidth: 64,
    paddingHorizontal: spacing[3],
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  label: { marginTop: spacing[4], marginBottom: spacing[2], marginLeft: spacing[1] },
  labelInline: { marginLeft: spacing[1] },

  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: 15,
  },
  bodyInput: { minHeight: 200, lineHeight: 22 },

  segment: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
  },

  catHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  addCatBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  catChips: { gap: spacing[2], paddingVertical: 2, paddingRight: spacing[4] },
  catChip: {
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },

  coverPick: {
    height: 160,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverImg: { width: '100%', height: '100%' },
  coverEmpty: { alignItems: 'center', gap: spacing[1.5] },
  coverRemove: {
    position: 'absolute',
    top: spacing[2],
    right: spacing[2],
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },

  toggleCard: {
    marginTop: spacing[5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3.5],
  },
});
