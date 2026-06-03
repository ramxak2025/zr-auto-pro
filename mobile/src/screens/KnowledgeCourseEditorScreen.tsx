/**
 * KnowledgeCourseEditorScreen — create / edit a course AND its lessons
 * (manager only).
 *
 * Route params:
 *   • {}        — create new course
 *   • { id }    — edit existing (prefills from getCourse, incl. lessons)
 *
 * Course fields: cover, title, description, published.
 * Lessons (only when editing an existing course — you must save the course
 * first to get an id): inline list with add / edit / delete. Each lesson opens
 * a bottom-sheet editor with title, markdown body, and a minimal quiz builder
 * (add questions → add options → mark the correct one).
 *
 * Deliberately utilitarian — no live preview. Fast and predictable.
 */
import React from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import type { KnowledgeCourse, KnowledgeLesson, KnowledgeQuizQuestion } from '../../../shared/types';

type ParamList = { KnowledgeCourseEditor: { id?: string } };
type Palette = ReturnType<typeof useColors>;

export default function KnowledgeCourseEditorScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ParamList, 'KnowledgeCourseEditor'>>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();

  const editId = route.params?.id;
  const isEdit = !!editId;

  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [coverImage, setCoverImage] = React.useState<string | null>(null);
  const [published, setPublished] = React.useState(true);
  const [uploading, setUploading] = React.useState(false);
  const [hydrated, setHydrated] = React.useState(false);

  const [lessonEditor, setLessonEditor] = React.useState<{ lesson: KnowledgeLesson | null } | null>(null);

  const { data: existing, isLoading: loadingExisting } = useQuery<KnowledgeCourse>({
    queryKey: ['knowledge-course', editId],
    queryFn: async () => (await knowledgeApi.getCourse(editId as string)).data,
    enabled: isEdit,
    staleTime: 10_000,
  });

  React.useEffect(() => {
    if (existing && !hydrated) {
      setTitle(existing.title);
      setDescription(existing.description ?? '');
      setCoverImage(existing.coverImage ?? null);
      setPublished(existing.published);
      setHydrated(true);
    }
  }, [existing, hydrated]);

  const lessons = existing?.lessons ?? [];

  // ── Save course ─────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { title: title.trim(), description: description.trim(), coverImage, published };
      if (isEdit) return (await knowledgeApi.updateCourse(editId as string, payload)).data;
      return (await knowledgeApi.createCourse(payload)).data;
    },
    onSuccess: (course) => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['knowledge-courses'] });
      if (isEdit) {
        queryClient.invalidateQueries({ queryKey: ['knowledge-course', editId] });
        navigation.goBack();
      } else {
        // After creating, jump into the freshly-made course's editor so the
        // owner can add lessons (which need a course id).
        navigation.replace('KnowledgeCourseEditor', { id: course.id });
      }
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить курс. Попробуйте ещё раз.');
    },
  });

  const onSave = () => {
    if (!title.trim()) {
      Alert.alert('Название обязательно', 'Введите название курса.');
      return;
    }
    haptic('tap');
    saveMutation.mutate();
  };

  // ── Delete course ───────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async () => (await knowledgeApi.deleteCourse(editId as string)).data,
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['knowledge-courses'] });
      navigation.goBack();
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить курс.'),
  });

  const confirmDelete = () => {
    Alert.alert('Удалить курс?', 'Курс и все его уроки будут удалены. Действие необратимо.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);
  };

  // ── Delete lesson ───────────────────────────────────────────────────────
  const deleteLessonMutation = useMutation({
    mutationFn: async (id: string) => (await knowledgeApi.deleteLesson(id)).data,
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['knowledge-course', editId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-courses'] });
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить урок.'),
  });

  const confirmDeleteLesson = (lesson: KnowledgeLesson) => {
    Alert.alert('Удалить урок?', `«${lesson.title}» будет удалён.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteLessonMutation.mutate(lesson.id) },
    ]);
  };

  // ── Cover upload ────────────────────────────────────────────────────────
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
        title={isEdit ? 'Редактирование курса' : 'Новый курс'}
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
            <Pressable onPress={() => setCoverImage(null)} hitSlop={8} style={[styles.coverRemove, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
              <Ionicons name="close" size={16} color={colors.white} />
            </Pressable>
          ) : null}
        </Pressable>

        {/* Title */}
        <Text style={[iosSectionLabel, styles.label, { color: palette.text.secondary }]}>Название</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Название курса"
          placeholderTextColor={palette.text.tertiary}
          style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary }]}
        />

        {/* Description */}
        <Text style={[iosSectionLabel, styles.label, { color: palette.text.secondary }]}>Описание</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder="Коротко о курсе"
          placeholderTextColor={palette.text.tertiary}
          multiline
          textAlignVertical="top"
          style={[styles.input, styles.descInput, { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary }]}
        />

        {/* Published */}
        <View style={[styles.toggleCard, { backgroundColor: inputBg, borderColor: inputBorder }]}>
          <View style={styles.toggleRow}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyEmph" style={{ color: palette.text.primary }}>
                Опубликован
              </Text>
              <Text variant="caption" style={{ color: palette.text.tertiary }}>
                Видно сотрудникам в учебном центре
              </Text>
            </View>
            <Switch value={published} onValueChange={setPublished} />
          </View>
        </View>

        {/* Lessons (edit-only) */}
        {isEdit ? (
          <>
            <View style={styles.lessonsHeader}>
              <Text style={[iosSectionLabel, { color: palette.text.secondary }]}>Уроки</Text>
              <Pressable
                onPress={() => {
                  haptic('tap');
                  setLessonEditor({ lesson: null });
                }}
                hitSlop={8}
                style={styles.addCatBtn}
              >
                <Ionicons name="add" size={16} color={palette.accent.primary} />
                <Text variant="footnote" style={{ color: palette.accent.primary, fontWeight: '600' }}>
                  Урок
                </Text>
              </Pressable>
            </View>
            <View style={{ gap: spacing[2] }}>
              {lessons.map((lesson, idx) => (
                <View
                  key={lesson.id}
                  style={[styles.lessonRow, { backgroundColor: inputBg, borderColor: inputBorder }]}
                >
                  <Pressable
                    style={styles.lessonMain}
                    onPress={() => {
                      haptic('tap');
                      setLessonEditor({ lesson });
                    }}
                  >
                    <Text variant="bodyEmph" numberOfLines={1} style={{ color: palette.text.primary }}>
                      {idx + 1}. {lesson.title}
                    </Text>
                    {lesson.hasQuiz ? (
                      <Text variant="caption" style={{ color: palette.accent.primary, fontWeight: '600' }}>
                        Тест · {lesson.quiz?.length ?? 0} вопр.
                      </Text>
                    ) : (
                      <Text variant="caption" style={{ color: palette.text.tertiary }}>
                        Без теста
                      </Text>
                    )}
                  </Pressable>
                  <Pressable onPress={() => confirmDeleteLesson(lesson)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={18} color={colors.red[500]} />
                  </Pressable>
                </View>
              ))}
              {lessons.length === 0 ? (
                <Text variant="footnote" style={{ color: palette.text.tertiary }}>
                  Уроков пока нет. Нажмите «Урок», чтобы добавить.
                </Text>
              ) : null}
            </View>

            {/* Delete course */}
            <Pressable onPress={confirmDelete} style={[styles.deleteBtn, { borderColor: colors.red[200] }]}>
              <Ionicons name="trash-outline" size={18} color={colors.red[600]} />
              <Text variant="bodyEmph" style={{ color: colors.red[600] }}>
                Удалить курс
              </Text>
            </Pressable>
          </>
        ) : (
          <Text variant="footnote" style={{ color: palette.text.tertiary, marginTop: spacing[4] }}>
            Сохраните курс, чтобы добавить уроки.
          </Text>
        )}
      </ScrollView>

      {/* Lesson editor sheet */}
      {lessonEditor && editId ? (
        <LessonEditorSheet
          courseId={editId}
          lesson={lessonEditor.lesson}
          existingCount={lessons.length}
          palette={palette}
          onClose={() => setLessonEditor(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['knowledge-course', editId] });
            queryClient.invalidateQueries({ queryKey: ['knowledge-courses'] });
            setLessonEditor(null);
          }}
        />
      ) : null}
    </View>
  );
}

// ──────────────────────────────────────────────────────────────────────────
//  Lesson editor — bottom sheet with a minimal quiz builder.
// ──────────────────────────────────────────────────────────────────────────

function LessonEditorSheet({
  courseId,
  lesson,
  existingCount,
  palette,
  onClose,
  onSaved,
}: {
  courseId: string;
  lesson: KnowledgeLesson | null;
  existingCount: number;
  palette: Palette;
  onClose: () => void;
  onSaved: () => void;
}) {
  const insets = useSafeAreaInsets();
  const isEdit = !!lesson;

  const [title, setTitle] = React.useState(lesson?.title ?? '');
  const [body, setBody] = React.useState(lesson?.body ?? '');
  const [hasQuiz, setHasQuiz] = React.useState(!!lesson?.hasQuiz);
  const [quiz, setQuiz] = React.useState<QuizDraft[]>(() =>
    (lesson?.quiz ?? []).map((q) => ({
      question: q.question,
      options: q.options.length ? [...q.options] : ['', ''],
      correctIndex: q.correctIndex ?? 0,
    })),
  );

  const save = useMutation({
    mutationFn: async () => {
      const quizPayload: KnowledgeQuizQuestion[] | null = hasQuiz
        ? quiz
            .filter((q) => q.question.trim() && q.options.filter((o) => o.trim()).length >= 2)
            .map((q) => ({
              question: q.question.trim(),
              options: q.options.map((o) => o.trim()).filter(Boolean),
              correctIndex: clampCorrect(q),
            }))
        : null;
      const payload = {
        title: title.trim(),
        body,
        sortOrder: isEdit ? lesson!.sortOrder : existingCount,
        quiz: quizPayload,
      };
      if (isEdit) return (await knowledgeApi.updateLesson(lesson!.id, payload)).data;
      return (await knowledgeApi.createLesson(courseId, payload)).data;
    },
    onSuccess: () => {
      haptic('success');
      onSaved();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить урок.');
    },
  });

  const onSubmit = () => {
    if (!title.trim()) {
      Alert.alert('Название обязательно', 'Введите название урока.');
      return;
    }
    if (hasQuiz) {
      const valid = quiz.filter((q) => q.question.trim() && q.options.filter((o) => o.trim()).length >= 2);
      if (valid.length === 0) {
        Alert.alert('Тест пуст', 'Добавьте хотя бы один вопрос с двумя вариантами или выключите тест.');
        return;
      }
    }
    haptic('tap');
    save.mutate();
  };

  const inputBg = palette.bg.muted;
  const inputBorder = palette.border.subtle;

  const addQuestion = () => {
    haptic('tap');
    setQuiz((prev) => [...prev, { question: '', options: ['', ''], correctIndex: 0 }]);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <View style={[styles.sheet, { backgroundColor: palette.bg.canvas, paddingBottom: Math.max(insets.bottom, spacing[3]) }]}>
          <View style={[styles.sheetHandle, { backgroundColor: palette.border.strong }]} />
          <View style={styles.sheetHeader}>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text variant="body" style={{ color: palette.text.secondary }}>
                Отмена
              </Text>
            </Pressable>
            <Text variant="bodyEmph" style={{ color: palette.text.primary }}>
              {isEdit ? 'Урок' : 'Новый урок'}
            </Text>
            <Pressable onPress={onSubmit} hitSlop={8} disabled={save.isPending}>
              <Text variant="bodyEmph" style={{ color: palette.accent.primary, opacity: save.isPending ? 0.5 : 1 }}>
                {save.isPending ? '…' : 'Готово'}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.sheetScroll}
            contentContainerStyle={{ paddingBottom: spacing[6] }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={[iosSectionLabel, styles.label, { color: palette.text.secondary }]}>Название</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Название урока"
              placeholderTextColor={palette.text.tertiary}
              style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary }]}
            />

            <Text style={[iosSectionLabel, styles.label, { color: palette.text.secondary }]}>Текст (Markdown)</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={'# Заголовок\n\nТекст урока…'}
              placeholderTextColor={palette.text.tertiary}
              multiline
              textAlignVertical="top"
              style={[styles.input, styles.bodyInput, { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary }]}
            />

            {/* Quiz toggle */}
            <View style={[styles.toggleCard, { backgroundColor: inputBg, borderColor: inputBorder, marginTop: spacing[4] }]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyEmph" style={{ color: palette.text.primary }}>
                    Тест в конце урока
                  </Text>
                  <Text variant="caption" style={{ color: palette.text.tertiary }}>
                    Чтобы пройти урок, нужно ответить верно на все вопросы
                  </Text>
                </View>
                <Switch value={hasQuiz} onValueChange={setHasQuiz} />
              </View>
            </View>

            {hasQuiz ? (
              <View style={{ marginTop: spacing[3], gap: spacing[3] }}>
                {quiz.map((q, qIdx) => (
                  <QuestionEditor
                    key={qIdx}
                    draft={q}
                    index={qIdx}
                    palette={palette}
                    onChange={(next) => setQuiz((prev) => prev.map((p, i) => (i === qIdx ? next : p)))}
                    onRemove={() => setQuiz((prev) => prev.filter((_, i) => i !== qIdx))}
                  />
                ))}
                <Pressable onPress={addQuestion} style={[styles.addQuestionBtn, { borderColor: palette.accent.primary }]}>
                  <Ionicons name="add-circle-outline" size={18} color={palette.accent.primary} />
                  <Text variant="bodyEmph" style={{ color: palette.accent.primary }}>
                    Добавить вопрос
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

interface QuizDraft {
  question: string;
  options: string[];
  correctIndex: number;
}

function clampCorrect(q: QuizDraft): number {
  // After dropping blank options, keep the correct marker pointing at the same
  // non-blank option (or the first one if it was on a removed blank).
  const kept: number[] = [];
  q.options.forEach((o, i) => {
    if (o.trim()) kept.push(i);
  });
  const pos = kept.indexOf(q.correctIndex);
  return pos >= 0 ? pos : 0;
}

function QuestionEditor({
  draft,
  index,
  palette,
  onChange,
  onRemove,
}: {
  draft: QuizDraft;
  index: number;
  palette: Palette;
  onChange: (next: QuizDraft) => void;
  onRemove: () => void;
}) {
  const inputBg = palette.bg.card;
  const inputBorder = palette.border.subtle;

  return (
    <View style={[styles.questionCard, { backgroundColor: palette.bg.card, borderColor: inputBorder }]}>
      <View style={styles.questionHeader}>
        <Text variant="caption" style={{ color: palette.text.tertiary, fontWeight: '700' }}>
          ВОПРОС {index + 1}
        </Text>
        <Pressable onPress={onRemove} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={palette.text.tertiary} />
        </Pressable>
      </View>
      <TextInput
        value={draft.question}
        onChangeText={(t) => onChange({ ...draft, question: t })}
        placeholder="Текст вопроса"
        placeholderTextColor={palette.text.tertiary}
        style={[styles.input, { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary, marginBottom: spacing[2] }]}
      />
      <Text variant="caption" style={{ color: palette.text.tertiary, marginBottom: spacing[1.5] }}>
        Отметьте правильный вариант
      </Text>
      <View style={{ gap: spacing[2] }}>
        {draft.options.map((opt, optIdx) => {
          const correct = draft.correctIndex === optIdx;
          return (
            <View key={optIdx} style={styles.optionEditRow}>
              <Pressable onPress={() => onChange({ ...draft, correctIndex: optIdx })} hitSlop={6}>
                <Ionicons
                  name={correct ? 'checkmark-circle' : 'ellipse-outline'}
                  size={22}
                  color={correct ? colors.green[500] : palette.text.tertiary}
                />
              </Pressable>
              <TextInput
                value={opt}
                onChangeText={(t) => onChange({ ...draft, options: draft.options.map((o, i) => (i === optIdx ? t : o)) })}
                placeholder={`Вариант ${optIdx + 1}`}
                placeholderTextColor={palette.text.tertiary}
                style={[styles.optionInput, { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary }]}
              />
              {draft.options.length > 2 ? (
                <Pressable
                  onPress={() => {
                    const nextOptions = draft.options.filter((_, i) => i !== optIdx);
                    const nextCorrect = draft.correctIndex >= nextOptions.length ? nextOptions.length - 1 : draft.correctIndex;
                    onChange({ ...draft, options: nextOptions, correctIndex: Math.max(0, nextCorrect) });
                  }}
                  hitSlop={6}
                >
                  <Ionicons name="remove-circle-outline" size={20} color={colors.red[400]} />
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </View>
      <Pressable
        onPress={() => onChange({ ...draft, options: [...draft.options, ''] })}
        hitSlop={6}
        style={styles.addOptionBtn}
      >
        <Ionicons name="add" size={15} color={palette.accent.primary} />
        <Text variant="footnote" style={{ color: palette.accent.primary, fontWeight: '600' }}>
          Вариант
        </Text>
      </Pressable>
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
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: 15,
  },
  descInput: { minHeight: 80, lineHeight: 21 },
  bodyInput: { minHeight: 180, lineHeight: 22 },

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

  toggleCard: {
    marginTop: spacing[5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3.5] },

  lessonsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[5],
    marginBottom: spacing[2],
  },
  addCatBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  lessonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
  },
  lessonMain: { flex: 1, gap: 2 },

  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[3.5],
    marginTop: spacing[6],
  },

  // Sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    maxHeight: '92%',
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing[2] },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    marginBottom: spacing[1],
  },
  sheetScroll: {},

  questionCard: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
  },
  questionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[2] },
  optionEditRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  optionInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: 15,
  },
  addOptionBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: spacing[2], alignSelf: 'flex-start' },
  addQuestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    paddingVertical: spacing[3],
  },
});
