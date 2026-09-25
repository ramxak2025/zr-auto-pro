import { useRef, useState } from 'react';
import { Type, Heading, ImagePlus, Video, ArrowUp, ArrowDown, Trash2, AlertCircle, PlayCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { KnowledgeBlock } from '../../types';
import { uploadsApi } from '../../api/services';
import { Button } from '../../ui/Button';
import { IconButton } from '../../ui/IconButton';
import { Input } from '../../ui/Input';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Textarea } from '../../ui/Textarea';
import { parseVkEmbedUrl } from './vkVideo';

// ───────────────────────────────────────────────────────────────────────
//  Block editor — compose an article from ordered content blocks.
//  Managers add / reorder (up·down) / delete blocks:
//    • text     — paragraph (textarea)
//    • heading  — H2/H3 toggle
//    • image    — upload via uploadsApi → image block + caption
//    • video    — paste a VK link → VK video block + caption
//  The parent owns the array; this component only emits the next array.
// ───────────────────────────────────────────────────────────────────────

const BLOCK_META: Record<KnowledgeBlock['type'], { label: string; icon: typeof Type }> = {
  text: { label: 'Текст', icon: Type },
  heading: { label: 'Заголовок', icon: Heading },
  image: { label: 'Изображение', icon: ImagePlus },
  video: { label: 'Видео VK', icon: Video },
};

export default function BlockEditor({
  blocks,
  onChange,
}: {
  blocks: KnowledgeBlock[];
  onChange: (next: KnowledgeBlock[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = (index: number, patch: Partial<KnowledgeBlock>) =>
    onChange(blocks.map((b, i) => (i === index ? ({ ...b, ...patch } as KnowledgeBlock) : b)));

  const remove = (index: number) => onChange(blocks.filter((_, i) => i !== index));

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    const next = blocks.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const add = (block: KnowledgeBlock) => onChange([...blocks, block]);

  const handleImageUpload = async (file: File) => {
    setUploading(true);
    try {
      const res = await uploadsApi.upload(file);
      add({ type: 'image', url: res.data.url, caption: '' });
    } catch {
      toast.error('Не удалось загрузить изображение');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      {blocks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line-strong bg-surface-2 px-4 py-8 text-center text-sm text-ink-3">
          Пока нет блоков. Добавьте текст, заголовок, изображение или видео кнопками ниже.
        </div>
      ) : (
        <ol className="space-y-3" aria-label="Блоки статьи">
          {blocks.map((block, i) => {
            const meta = BLOCK_META[block.type];
            const MetaIcon = meta.icon;
            return (
              <li key={i} className="rounded-lg border border-line bg-surface p-3 shadow-card">
                {/* Block toolbar */}
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-3">
                    <MetaIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {meta.label}
                    <span className="font-normal tabular-nums text-ink-4">#{i + 1}</span>
                  </span>
                  <div className="flex items-center gap-0.5">
                    <IconButton label="Выше" icon={ArrowUp} size="sm" onClick={() => move(i, -1)} disabled={i === 0} />
                    <IconButton
                      label="Ниже"
                      icon={ArrowDown}
                      size="sm"
                      onClick={() => move(i, 1)}
                      disabled={i === blocks.length - 1}
                    />
                    <IconButton
                      label="Удалить блок"
                      icon={Trash2}
                      size="sm"
                      variant="danger"
                      onClick={() => remove(i)}
                    />
                  </div>
                </div>

                {/* Block body */}
                {block.type === 'text' && (
                  <Textarea
                    value={block.text}
                    onChange={(e) => update(i, { text: e.target.value })}
                    placeholder="Текст абзаца…"
                    rows={4}
                    aria-label={`Текст блока ${i + 1}`}
                    className="leading-relaxed"
                  />
                )}

                {block.type === 'heading' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={block.text}
                      onChange={(e) => update(i, { text: e.target.value })}
                      placeholder="Текст заголовка…"
                      aria-label={`Заголовок блока ${i + 1}`}
                      className="min-w-[12rem] flex-1 font-semibold"
                    />
                    <SegmentedControl
                      size="sm"
                      aria-label="Уровень заголовка"
                      value={block.level === 3 ? '3' : '2'}
                      onChange={(v) => update(i, { level: v === '3' ? 3 : 2 })}
                      options={[
                        { value: '2', label: 'H2' },
                        { value: '3', label: 'H3' },
                      ]}
                    />
                  </div>
                )}

                {block.type === 'image' && (
                  <div className="space-y-2">
                    <div className="overflow-hidden rounded-lg border border-line bg-surface-2">
                      <img src={block.url} alt={block.caption || ''} className="max-h-56 w-full object-contain" />
                    </div>
                    <Input
                      value={block.caption ?? ''}
                      onChange={(e) => update(i, { caption: e.target.value })}
                      placeholder="Подпись (необязательно)"
                      aria-label="Подпись к изображению"
                    />
                  </div>
                )}

                {block.type === 'video' && (
                  <VideoBlockEditor
                    url={block.url}
                    caption={block.caption ?? ''}
                    onUrlChange={(url) => update(i, { url })}
                    onCaptionChange={(caption) => update(i, { caption })}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Add-block toolbar */}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button variant="secondary" size="sm" icon={Type} onClick={() => add({ type: 'text', text: '' })}>
          Текст
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={Heading}
          onClick={() => add({ type: 'heading', text: '', level: 2 })}
        >
          Заголовок
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={ImagePlus}
          onClick={() => fileInputRef.current?.click()}
          loading={uploading}
        >
          Изображение
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={Video}
          onClick={() => add({ type: 'video', provider: 'vk', url: '', caption: '' })}
        >
          Видео VK
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImageUpload(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  VK video block — link input + live embed preview
// ───────────────────────────────────────────────────────────────────────
function VideoBlockEditor({
  url,
  caption,
  onUrlChange,
  onCaptionChange,
}: {
  url: string;
  caption: string;
  onUrlChange: (url: string) => void;
  onCaptionChange: (caption: string) => void;
}) {
  const embed = parseVkEmbedUrl(url);
  const invalid = url.trim().length > 0 && !embed;

  return (
    <div className="space-y-2">
      <Input
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="Ссылка на видео VK — например https://vk.com/video-123_456"
        aria-label="Ссылка на видео VK"
        invalid={invalid}
      />
      {invalid && (
        <p className="flex items-center gap-1.5 text-xs text-bad-text" role="alert">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" /> Не похоже на ссылку VK Видео.
        </p>
      )}
      {embed && (
        <div className="relative overflow-hidden rounded-lg border border-line bg-ink pt-[56.25%]">
          <iframe
            src={embed}
            title="Предпросмотр VK видео"
            className="absolute inset-0 h-full w-full"
            frameBorder={0}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture;"
            allowFullScreen
          />
        </div>
      )}
      {!url.trim() && (
        <p className="flex items-center gap-1.5 text-xs text-ink-3">
          <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" /> Вставьте ссылку на видео из VK, чтобы появился
          предпросмотр.
        </p>
      )}
      <Input
        value={caption}
        onChange={(e) => onCaptionChange(e.target.value)}
        placeholder="Подпись (необязательно)"
        aria-label="Подпись к видео"
      />
    </div>
  );
}
