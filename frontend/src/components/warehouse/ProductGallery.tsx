import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Package } from 'lucide-react';
import { IconButton } from '../../ui/IconButton';
import PhotoLightbox from './PhotoLightbox';

export default function ProductGallery({ photos, name }: { photos: string[]; name: string }) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const show = (next: number) => {
    const bounded = Math.max(0, Math.min(photos.length - 1, next));
    scroll.current?.scrollTo({ left: bounded * scroll.current.clientWidth, behavior: 'smooth' });
    setIndex(bounded);
  };
  if (!photos.length)
    return (
      <div className="flex h-40 items-center justify-center rounded-xl bg-surface-2">
        <Package className="h-10 w-10 text-ink-3" />
      </div>
    );
  return (
    <div className="min-w-0 space-y-2">
      <div
        ref={scroll}
        className="flex snap-x snap-mandatory overflow-x-auto rounded-xl bg-surface-2"
        onScroll={(event) => {
          const element = event.currentTarget;
          setIndex(Math.round(element.scrollLeft / Math.max(1, element.clientWidth)));
        }}
      >
        {photos.map((url, itemIndex) => (
          <button
            key={url}
            type="button"
            className="h-60 w-full flex-shrink-0 snap-center focus-visible:outline-accent"
            onClick={() => {
              setIndex(itemIndex);
              setOpen(true);
            }}
            aria-label={`Открыть фото ${itemIndex + 1} из ${photos.length}`}
          >
            <img src={url} alt={`${name}, фото ${itemIndex + 1}`} className="h-full w-full object-contain" />
          </button>
        ))}
      </div>
      {photos.length > 1 && (
        <div className="flex items-center justify-center gap-3">
          <IconButton
            label="Предыдущее фото"
            icon={ChevronLeft}
            size="sm"
            disabled={index === 0}
            onClick={() => show(index - 1)}
          />
          <span className="text-xs tabular-nums text-ink-2" aria-live="polite">
            {index + 1} / {photos.length}
          </span>
          <IconButton
            label="Следующее фото"
            icon={ChevronRight}
            size="sm"
            disabled={index >= photos.length - 1}
            onClick={() => show(index + 1)}
          />
        </div>
      )}
      <PhotoLightbox
        url={open ? photos[Math.min(index, photos.length - 1)] : null}
        urls={photos}
        initialIndex={index}
        alt={name}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
