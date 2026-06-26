import { useRef, useState } from 'react';
import {
  Type,
  Heading,
  ImagePlus,
  Video,
  ArrowUp,
  ArrowDown,
  Trash2,
  Loader2,
  AlertCircle,
  PlayCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { KnowledgeBlock } from '../../types';
import { uploadsApi } from '../../api/services';
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
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/60 px-4 py-8 text-center text-sm text-gray-500">
          Пока нет блоков. Добавьте текст, заголовок, изображение или видео ниже.
        </div>
      ) : (
        blocks.map((block, i) => (
          <div key={i} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
            {/* Block toolbar */}
            <div className="mb-2 flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {block.type === 'text' && (
                  <>
                    <Type className="h-3.5 w-3.5" /> Текст
                  </>
                )}
                {block.type === 'heading' && (
                  <>
                    <Heading className="h-3.5 w-3.5" /> Заголовок
                  </>
                )}
                {block.type === 'image' && (
                  <>
                    <ImagePlus className="h-3.5 w-3.5" /> Изображение
                  </>
                )}
                {block.type === 'video' && (
                  <>
                    <Video className="h-3.5 w-3.5" /> Видео VK
                  </>
                )}
              </span>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  title="Выше"
                  className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === blocks.length - 1}
                  title="Ниже"
                  className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-30"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  title="Удалить блок"
                  className="rounded-md p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Block body */}
            {block.type === 'text' && (
              <textarea
                value={block.text}
                onChange={(e) => update(i, { text: e.target.value })}
                placeholder="Текст абзаца…"
                rows={4}
                className="input resize-y text-sm leading-relaxed"
              />
            )}

            {block.type === 'heading' && (
              <div className="flex items-center gap-2">
                <input
                  value={block.text}
                  onChange={(e) => update(i, { text: e.target.value })}
                  placeholder="Текст заголовка…"
                  className="input flex-1 font-semibold"
                />
                <div className="flex rounded-lg border border-gray-200 p-0.5">
                  <button
                    type="button"
                    onClick={() => update(i, { level: 2 })}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      (block.level ?? 2) === 2 ? 'bg-primary-600 text-white' : 'text-gray-500'
                    }`}
                  >
                    H2
                  </button>
                  <button
                    type="button"
                    onClick={() => update(i, { level: 3 })}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                      block.level === 3 ? 'bg-primary-600 text-white' : 'text-gray-500'
                    }`}
                  >
                    H3
                  </button>
                </div>
              </div>
            )}

            {block.type === 'image' && (
              <div className="space-y-2">
                <div className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                  <img src={block.url} alt={block.caption || ''} className="max-h-56 w-full object-contain" />
                </div>
                <input
                  value={block.caption ?? ''}
                  onChange={(e) => update(i, { caption: e.target.value })}
                  placeholder="Подпись (необязательно)"
                  className="input text-sm"
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
          </div>
        ))
      )}

      {/* Add-block toolbar */}
      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
        <button type="button" onClick={() => add({ type: 'text', text: '' })} className="btn-secondary btn-sm">
          <Type className="h-4 w-4" /> Текст
        </button>
        <button
          type="button"
          onClick={() => add({ type: 'heading', text: '', level: 2 })}
          className="btn-secondary btn-sm"
        >
          <Heading className="h-4 w-4" /> Заголовок
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="btn-secondary btn-sm"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} Изображение
        </button>
        <button
          type="button"
          onClick={() => add({ type: 'video', provider: 'vk', url: '', caption: '' })}
          className="btn-secondary btn-sm"
        >
          <Video className="h-4 w-4" /> Видео VK
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
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
      <input
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        placeholder="Ссылка на видео VK — например https://vk.com/video-123_456"
        className={`input text-sm ${invalid ? 'input-error' : ''}`}
      />
      {invalid && (
        <p className="flex items-center gap-1.5 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5" /> Не похоже на ссылку VK Видео.
        </p>
      )}
      {embed && (
        <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-black pt-[56.25%]">
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
        <p className="flex items-center gap-1.5 text-xs text-gray-400">
          <PlayCircle className="h-3.5 w-3.5" /> Вставьте ссылку на видео из VK, чтобы появился предпросмотр.
        </p>
      )}
      <input
        value={caption}
        onChange={(e) => onCaptionChange(e.target.value)}
        placeholder="Подпись (необязательно)"
        className="input text-sm"
      />
    </div>
  );
}
