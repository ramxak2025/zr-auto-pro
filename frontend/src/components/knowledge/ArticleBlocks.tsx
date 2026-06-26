import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, PlayCircle } from 'lucide-react';
import type { KnowledgeBlock } from '../../types';
import { parseVkEmbedUrl } from './vkVideo';

// ───────────────────────────────────────────────────────────────────────
//  Block reader — renders an ordered KnowledgeBlock[] in article order.
//  text → paragraph, heading → h2/h3, image → figure (click → lightbox),
//  video → responsive VK iframe with caption.
// ───────────────────────────────────────────────────────────────────────

export default function ArticleBlocksReader({ blocks }: { blocks: KnowledgeBlock[] }) {
  const [lightbox, setLightbox] = useState<{ url: string; caption?: string } | null>(null);

  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-gray-800">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading':
            return block.level === 3 ? (
              <h3 key={i} className="mt-5 text-lg font-semibold text-gray-900 first:mt-0">
                {block.text}
              </h3>
            ) : (
              <h2 key={i} className="mt-6 text-xl font-bold text-gray-900 first:mt-0">
                {block.text}
              </h2>
            );

          case 'text':
            // Preserve author line breaks without a markdown dependency.
            return (
              <p key={i} className="whitespace-pre-wrap">
                {block.text}
              </p>
            );

          case 'image':
            return (
              <figure key={i} className="my-2">
                <button
                  type="button"
                  onClick={() => setLightbox({ url: block.url, caption: block.caption })}
                  className="block w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50 transition-opacity hover:opacity-95"
                >
                  <img
                    src={block.url}
                    alt={block.caption || ''}
                    loading="lazy"
                    className="max-h-[28rem] w-full object-contain"
                  />
                </button>
                {block.caption && (
                  <figcaption className="mt-1.5 text-center text-xs text-gray-500">{block.caption}</figcaption>
                )}
              </figure>
            );

          case 'video': {
            const embed = parseVkEmbedUrl(block.url);
            return (
              <figure key={i} className="my-2">
                {embed ? (
                  <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-black pt-[56.25%]">
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
                    className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-primary-600 hover:bg-gray-100"
                  >
                    <PlayCircle className="h-5 w-5" /> Открыть видео в VK
                  </a>
                )}
                {block.caption && (
                  <figcaption className="mt-1.5 text-center text-xs text-gray-500">{block.caption}</figcaption>
                )}
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
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/85 p-4"
        onClick={onClose}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        >
          <X className="h-5 w-5" />
        </button>
        <motion.img
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
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
