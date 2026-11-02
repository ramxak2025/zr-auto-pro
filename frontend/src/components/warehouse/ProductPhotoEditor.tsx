import { moveProductPhoto, MAX_PRODUCT_PHOTOS } from '../../../../shared/utils/productPhotos';
import { useState } from 'react';
import ImageUpload from '../ImageUpload';
import { Button } from '../../ui/Button';

export default function ProductPhotoEditor({
  photos,
  onChange,
  onBusyChange,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const uploading = (value: boolean) => {
    setBusy(value);
    onBusyChange?.(value);
  };
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink-2">
        Фотографии · {photos.length}/{MAX_PRODUCT_PHOTOS}
      </p>
      <div className="flex flex-wrap gap-3">
        {photos.map((url, index) => (
          <div key={`${index}-${url}`} className="space-y-1">
            <ImageUpload
              disabled={busy}
              onBusyChange={uploading}
              variant="avatar"
              label={`Фото ${index + 1}`}
              value={url}
              onChange={(next) => onChange(photos.map((item, at) => (at === index ? next : item)))}
              onClear={() => onChange(photos.filter((_, at) => at !== index))}
            />
            {index === 0 ? (
              <p className="text-xs text-ink-3">Обложка</p>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onChange(moveProductPhoto(photos, index, 0))}
              >
                На обложку
              </Button>
            )}
          </div>
        ))}
        {photos.length < MAX_PRODUCT_PHOTOS && (
          <ImageUpload
            disabled={busy}
            onBusyChange={uploading}
            variant="avatar"
            label="Добавить фото товара"
            onChange={(url) => onChange([...photos, url])}
          />
        )}
      </div>
      <p className="text-xs text-ink-3">До четырёх фото. Первое — обложка.</p>
    </div>
  );
}
