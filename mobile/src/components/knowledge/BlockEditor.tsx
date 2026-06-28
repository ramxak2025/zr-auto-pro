/**
 * BlockEditor — compose a Knowledge Base article from ordered content blocks,
 * mirroring the web `frontend/src/components/knowledge/BlockEditor.tsx`.
 *
 * A manager builds the rich micro-article right on the phone: текст → фото
 * (видно сразу) → текст → видео → текст. Each block can be moved up/down or
 * deleted; new blocks are appended from the toolbar at the bottom.
 *
 * Block kinds (079 contract):
 *   • text     — paragraph (multiline input).
 *   • heading  — H2 / H3 toggle.
 *   • image    — pick from library → uploadsApi.upload → store returned url +
 *                optional caption. The preview renders the uploaded image inline
 *                so the author sees exactly what the reader will see.
 *   • video    — paste a VK link, validated with the SAME `vkEmbedUrl` the reader
 *                uses, so a link that won't embed is flagged before saving.
 *
 * The parent owns the array; this component only emits the next array via
 * `onChange`. `sanitizeBlocks` / `hasInvalidVideoBlock` are exported so the
 * editor screen can clean the payload and block a save on a bad VK link.
 *
 * JS-only (expo-image-picker is already a dependency, used for cover/product
 * images) — no native module, ships via OTA. Android-safe.
 */
import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import CachedImage from '../CachedImage';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { uploadsApi } from '../../api/services';
import { getImageUrl } from '../../api/axios';
import { haptic } from '../../platform/haptics';
import { vkEmbedUrl } from '../KnowledgeBlocks';
import type { KnowledgeBlock } from '../../../../shared/types';

// ── Pure helpers (exported for the editor screen) ───────────────────────────

/**
 * Drop empty / half-filled blocks so the server never sees an invalid block,
 * and normalise text (trim, default heading level, empty caption → undefined).
 * Invalid VK video blocks are dropped here too — `hasInvalidVideoBlock` lets the
 * caller warn the user FIRST so a typo isn't silently lost.
 */
export function sanitizeBlocks(blocks: KnowledgeBlock[]): KnowledgeBlock[] {
  const clean: KnowledgeBlock[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'text': {
        const text = b.text.trim();
        if (text) clean.push({ type: 'text', text });
        break;
      }
      case 'heading': {
        const text = b.text.trim();
        if (text) clean.push({ type: 'heading', text, level: b.level ?? 2 });
        break;
      }
      case 'image': {
        const url = b.url.trim();
        if (url) clean.push({ type: 'image', url, caption: b.caption?.trim() || undefined });
        break;
      }
      case 'video': {
        const url = b.url.trim();
        if (url && vkEmbedUrl(url))
          clean.push({ type: 'video', provider: 'vk', url, caption: b.caption?.trim() || undefined });
        break;
      }
    }
  }
  return clean;
}

/** True when a video block has text but it isn't a recognisable VK link. */
export function hasInvalidVideoBlock(blocks: KnowledgeBlock[]): boolean {
  return blocks.some((b) => b.type === 'video' && b.url.trim().length > 0 && !vkEmbedUrl(b.url));
}

// ── Component ────────────────────────────────────────────────────────────────
interface BlockEditorProps {
  blocks: KnowledgeBlock[];
  onChange: (next: KnowledgeBlock[]) => void;
}

/**
 * A patch over any block field. `Partial<KnowledgeBlock>` collapses to `{ type? }`
 * because a discriminated union's `keyof` is the intersection of its members'
 * keys — so we list every editable field explicitly (all optional) and cast the
 * merged result back to `KnowledgeBlock`.
 */
type BlockPatch = Partial<{
  text: string;
  level: 2 | 3;
  url: string;
  caption: string;
}>;

const TYPE_META: Record<KnowledgeBlock['type'], { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  text: { icon: 'text-outline', label: 'Текст' },
  heading: { icon: 'pricetag-outline', label: 'Заголовок' },
  image: { icon: 'image-outline', label: 'Фото' },
  video: { icon: 'logo-vk', label: 'Видео VK' },
};

export default function BlockEditor({ blocks, onChange }: BlockEditorProps) {
  const palette = useColors();
  const [uploading, setUploading] = React.useState(false);

  const update = React.useCallback(
    (index: number, patch: BlockPatch) =>
      onChange(blocks.map((b, i) => (i === index ? ({ ...b, ...patch } as KnowledgeBlock) : b))),
    [blocks, onChange],
  );

  const remove = React.useCallback(
    (index: number) => {
      haptic('tap');
      onChange(blocks.filter((_, i) => i !== index));
    },
    [blocks, onChange],
  );

  const move = React.useCallback(
    (index: number, dir: -1 | 1) => {
      const target = index + dir;
      if (target < 0 || target >= blocks.length) return;
      haptic('select');
      const next = blocks.slice();
      [next[index], next[target]] = [next[target], next[index]];
      onChange(next);
    },
    [blocks, onChange],
  );

  const add = React.useCallback(
    (block: KnowledgeBlock) => {
      haptic('tap');
      onChange([...blocks, block]);
    },
    [blocks, onChange],
  );

  const addImage = React.useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (res.canceled) return;
      const asset = res.assets[0];
      setUploading(true);
      const up = await uploadsApi.upload(asset.uri, asset.fileName || 'image.jpg');
      haptic('success');
      onChange([...blocks, { type: 'image', url: up.data.url, caption: '' }]);
    } catch {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось загрузить изображение.');
    } finally {
      setUploading(false);
    }
  }, [blocks, onChange]);

  const inputBg = palette.bg.card;
  const inputBorder = palette.border.subtle;

  return (
    <View style={styles.root}>
      {blocks.length === 0 ? (
        <View style={[styles.empty, { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted }]}>
          <Ionicons name="albums-outline" size={22} color={palette.text.tertiary} />
          <Text variant="footnote" style={{ color: palette.text.tertiary, textAlign: 'center' }}>
            Пока нет блоков. Соберите статью: текст, заголовок, фото и видео — в нужном порядке.
          </Text>
        </View>
      ) : (
        blocks.map((block, i) => {
          const meta = TYPE_META[block.type];
          return (
            <View
              key={i}
              style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              {/* Toolbar */}
              <View style={styles.cardHead}>
                <View style={styles.typeLabel}>
                  <Ionicons name={meta.icon} size={14} color={palette.text.tertiary} />
                  <Text variant="caption" style={{ color: palette.text.tertiary, fontWeight: '700' }}>
                    {meta.label}
                  </Text>
                </View>
                <View style={styles.cardActions}>
                  <CardAction
                    icon="chevron-up"
                    disabled={i === 0}
                    onPress={() => move(i, -1)}
                    palette={palette}
                    label="Выше"
                  />
                  <CardAction
                    icon="chevron-down"
                    disabled={i === blocks.length - 1}
                    onPress={() => move(i, 1)}
                    palette={palette}
                    label="Ниже"
                  />
                  <CardAction
                    icon="trash-outline"
                    danger
                    onPress={() => remove(i)}
                    palette={palette}
                    label="Удалить блок"
                  />
                </View>
              </View>

              {/* Body */}
              {block.type === 'text' ? (
                <TextInput
                  value={block.text}
                  onChangeText={(text) => update(i, { text })}
                  placeholder="Текст абзаца…"
                  placeholderTextColor={palette.text.tertiary}
                  multiline
                  textAlignVertical="top"
                  style={[
                    styles.input,
                    styles.textInput,
                    { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary },
                  ]}
                />
              ) : null}

              {block.type === 'heading' ? (
                <View style={styles.headingRow}>
                  <TextInput
                    value={block.text}
                    onChangeText={(text) => update(i, { text })}
                    placeholder="Текст заголовка…"
                    placeholderTextColor={palette.text.tertiary}
                    style={[
                      styles.input,
                      styles.headingInput,
                      { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary },
                    ]}
                  />
                  <View style={[styles.levelSwitch, { backgroundColor: palette.bg.muted }]}>
                    {([2, 3] as const).map((lvl) => {
                      const active = (block.level ?? 2) === lvl;
                      return (
                        <Pressable
                          key={lvl}
                          onPress={() => {
                            haptic('select');
                            update(i, { level: lvl });
                          }}
                          style={[styles.levelItem, active && { backgroundColor: palette.accent.primary }]}
                        >
                          <Text
                            variant="caption"
                            style={{ color: active ? colors.white : palette.text.secondary, fontWeight: '700' }}
                          >
                            {`H${lvl}`}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {block.type === 'image' ? (
                <View style={styles.mediaBody}>
                  <CachedImage
                    source={{ uri: getImageUrl(block.url) }}
                    style={[styles.imagePreview, { backgroundColor: palette.bg.muted, borderColor: inputBorder }]}
                    resizeMode="cover"
                  />
                  <TextInput
                    value={block.caption ?? ''}
                    onChangeText={(caption) => update(i, { caption })}
                    placeholder="Подпись (необязательно)"
                    placeholderTextColor={palette.text.tertiary}
                    style={[
                      styles.input,
                      { backgroundColor: inputBg, borderColor: inputBorder, color: palette.text.primary },
                    ]}
                  />
                </View>
              ) : null}

              {block.type === 'video' ? (
                <VideoBlockBody
                  url={block.url}
                  caption={block.caption ?? ''}
                  onUrlChange={(url) => update(i, { url })}
                  onCaptionChange={(caption) => update(i, { caption })}
                  palette={palette}
                />
              ) : null}
            </View>
          );
        })
      )}

      {/* Add-block toolbar */}
      <View style={styles.addBar}>
        <AddButton
          icon="text-outline"
          label="Текст"
          onPress={() => add({ type: 'text', text: '' })}
          palette={palette}
        />
        <AddButton
          icon="pricetag-outline"
          label="Заголовок"
          onPress={() => add({ type: 'heading', text: '', level: 2 })}
          palette={palette}
        />
        <AddButton icon="image-outline" label="Фото" onPress={addImage} loading={uploading} palette={palette} />
        <AddButton
          icon="logo-vk"
          label="Видео"
          onPress={() => add({ type: 'video', provider: 'vk', url: '', caption: '' })}
          palette={palette}
        />
      </View>
    </View>
  );
}

// ── VK video block body — link input + live validation ───────────────────────
function VideoBlockBody({
  url,
  caption,
  onUrlChange,
  onCaptionChange,
  palette,
}: {
  url: string;
  caption: string;
  onUrlChange: (url: string) => void;
  onCaptionChange: (caption: string) => void;
  palette: ReturnType<typeof useColors>;
}) {
  const trimmed = url.trim();
  const embed = trimmed.length > 0 ? vkEmbedUrl(trimmed) : null;
  const invalid = trimmed.length > 0 && !embed;

  return (
    <View style={styles.mediaBody}>
      <TextInput
        value={url}
        onChangeText={onUrlChange}
        placeholder="Ссылка VK — https://vk.com/video-123_456"
        placeholderTextColor={palette.text.tertiary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        style={[
          styles.input,
          {
            backgroundColor: palette.bg.card,
            borderColor: invalid ? colors.red[300] : palette.border.subtle,
            color: palette.text.primary,
          },
        ]}
      />
      {invalid ? (
        <View style={styles.videoHint}>
          <Ionicons name="alert-circle" size={14} color={colors.red[500]} />
          <Text variant="caption" style={{ color: colors.red[600], flex: 1 }}>
            Не похоже на ссылку VK Видео. Пример: vk.com/video-123_456
          </Text>
        </View>
      ) : embed ? (
        <View style={styles.videoHint}>
          <Ionicons name="checkmark-circle" size={14} color={colors.green[600]} />
          <Text variant="caption" style={{ color: palette.text.tertiary, flex: 1 }}>
            VK видео распознано — проиграется прямо в статье.
          </Text>
        </View>
      ) : (
        <View style={styles.videoHint}>
          <Ionicons name="play-circle-outline" size={14} color={palette.text.tertiary} />
          <Text variant="caption" style={{ color: palette.text.tertiary, flex: 1 }}>
            Вставьте ссылку на видео из VK.
          </Text>
        </View>
      )}
      <TextInput
        value={caption}
        onChangeText={onCaptionChange}
        placeholder="Подпись (необязательно)"
        placeholderTextColor={palette.text.tertiary}
        style={[
          styles.input,
          { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, color: palette.text.primary },
        ]}
      />
    </View>
  );
}

// ── Tiny presentational helpers ──────────────────────────────────────────────
function CardAction({
  icon,
  onPress,
  disabled,
  danger,
  palette,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  palette: ReturnType<typeof useColors>;
  label: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={({ pressed }) => [styles.cardActionBtn, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={danger ? colors.red[500] : palette.text.secondary} />
    </Pressable>
  );
}

function AddButton({
  icon,
  label,
  onPress,
  loading,
  palette,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => [
        styles.addBtn,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.7 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Добавить блок: ${label}`}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.accent.primary} />
      ) : (
        <Ionicons name={icon} size={16} color={palette.accent.primary} />
      )}
      <Text variant="caption" style={{ color: palette.text.secondary, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing[2.5] },

  empty: {
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[5],
  },

  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    gap: spacing[2.5],
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typeLabel: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  cardActionBtn: { padding: spacing[1] },

  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: 15,
  },
  textInput: { minHeight: 92, lineHeight: 22 },

  headingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headingInput: { flex: 1, fontWeight: '600' },
  levelSwitch: { flexDirection: 'row', borderRadius: borderRadius.md, padding: 2, gap: 2 },
  levelItem: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.sm,
    minWidth: 34,
    alignItems: 'center',
  },

  mediaBody: { gap: spacing[2] },
  imagePreview: {
    width: '100%',
    height: 180,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  videoHint: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], paddingHorizontal: spacing[1] },

  addBar: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[1] },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    minHeight: 38,
  },
});
