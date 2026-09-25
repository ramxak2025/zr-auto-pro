import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, PlayCircle } from 'lucide-react';
import type { KnowledgeBlock } from '../../types';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { parseVkEmbedUrl } from './vkVideo';
import { articleType, headingClass, headingTag } from './articleTypography';

// ───────────────────────────────────────────────────────────────────────
//  Block reader — renders an ordered KnowledgeBlock[] in article order.
//  text → paragraph, heading → h3/h4 (под h2 заголовка статьи),
//  image → figure (click → lightbox), video → responsive VK iframe + caption.
//  Типографика — общая шкала articleTypography.ts (та же, что у markdown).
// ───────────────────────────────────────────────────────────────────────

export default function ArticleBlocksReader({ blocks }: { blocks: KnowledgeBlock[] }) {
  const [lightbox, setLightbox] = useState<{ url: string; caption?: string } | null>(null);

  return (
    <div className={articleType.body}>
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading': {
            // Блок «H2» — первый уровень внутри статьи (h3 под h2 заголовка), «H3» — второй.
            const depth = block.level === 3 ? 1 : 0;
            const Tag = headingTag(3 + depth);
            return (
              <Tag key={i} className={headingClass(depth)}>
                {block.text}
              </Tag>
            );
          }

          case 'text':
            // Переносы автора сохраняем без markdown-зависимости.
            return (
              <p key={i} className={cn(articleType.paragraph, 'whitespace-pre-wrap')}>
                {block.text}
              </p>
            );

          case 'image':
            return (
              <figure key={i} className={articleType.figure}>
                <button
                  type="button"
                  onClick={() => setLightbox({ url: block.url, caption: block.caption })}
                  aria-label={block.caption ? `Открыть изображение: ${block.caption}` : 'Открыть изображение'}
                  className={cn('block w-full overflow-hidden rounded-lg', focusRing)}
                >
                  <img
                    src={block.url}
                    alt={block.caption || ''}
                    loading="lazy"
                    className={cn(articleType.image, 'max-h-[28rem]')}
                  />
                </button>
                {block.caption && <figcaption className={articleType.figcaption}>{block.caption}</figcaption>}
              </figure>
            );

          case 'video': {
            const embed = parseVkEmbedUrl(block.url);
            return (
              <figure key={i} className={articleType.figure}>
                {embed ? (
                  <div className="relative overflow-hidden rounded-lg border border-line bg-ink pt-[56.25%]">
                    <iframe
                      src={embed}
                      title={block.caption || 'VK видео'}
                      className="absolute inset-0 h-full w-full"
                      frameBorder={0}
                      allow="autoplay; encrypted-media; fullscreen; picture-in-picture; screen-wake-lock;"
                      allowFullScreen
                    />
                  </div>
                ) : (
                  <a
                    href={block.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn(
                      'flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm font-medium text-accent-text hover:bg-surface-3',
                      focusRing,
                    )}
                  >
                    <PlayCircle className="h-5 w-5" aria-hidden="true" /> Открыть видео в VK
                  </a>
                )}
                {block.caption && <figcaption className={articleType.figcaption}>{block.caption}</figcaption>}
              </figure>
            );
          }

          default:
            return null;
        }
      })}

      {lightbox && <Lightbox url={lightbox.url} caption={lightbox.caption} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────
//  Image lightbox
// ───────────────────────────────────────────────────────────────────────
function Lightbox({ url, caption, onClose }: { url: string; caption?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={caption || 'Изображение'}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-ink/85 p-4"
        onClick={onClose}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          autoFocus
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        <motion.img
          initial={{ scale: 0.97, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.97, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
          src={url}
          alt={caption || ''}
          onClick={(e) => e.stopPropagation()}
          className="max-h-[85vh] max-w-full rounded-lg object-contain"
        />
        {caption && <p className="mt-3 max-w-2xl text-center text-sm text-white/80">{caption}</p>}
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
