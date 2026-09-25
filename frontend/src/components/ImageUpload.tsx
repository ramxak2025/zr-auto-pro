import { useState, useRef } from 'react';
import { Camera, Loader2, X, ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadsApi } from '../api/services';
import { cn } from '../ui/cn';
import { focusRing } from '../ui/tokens';
import { Button } from '../ui/Button';

interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onClear?: () => void;
  variant?: 'avatar' | 'product';
  className?: string;
  /** Доступное имя кнопки загрузки («Фото товара», «Аватар сотрудника»). */
  label?: string;
}

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/heic';

/**
 * Загрузка одного изображения: кнопка-плитка (пунктир → превью), спиннер на
 * время отправки, кнопка удаления с доступным именем. API прежний.
 */
export default function ImageUpload({
  value,
  onChange,
  onClear,
  variant = 'product',
  className = '',
  label,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const accessibleName = label ?? (variant === 'avatar' ? 'Фото' : 'Фото товара');

  const handleFile = async (file: File) => {
    if (file.size > MAX_SIZE) {
      toast.error('Файл слишком большой (макс. 5 МБ)');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Только изображения');
      return;
    }

    setUploading(true);
    try {
      const res = await uploadsApi.upload(file);
      onChange(res.data.url);
    } catch {
      toast.error('Ошибка загрузки');
    } finally {
      setUploading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    e.target.value = '';
  };

  const imageUrl = value || null;
  const fileInput = (
    <input ref={inputRef} type="file" accept={ACCEPTED} onChange={handleChange} className="hidden" tabIndex={-1} />
  );

  if (variant === 'avatar') {
    return (
      <div className={cn('relative inline-block', className)}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          aria-label={imageUrl ? `Заменить: ${accessibleName}` : `Загрузить: ${accessibleName}`}
          aria-busy={uploading || undefined}
          className={cn(
            'group relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-line-strong bg-surface-3',
            'transition-colors duration-150 hover:border-accent disabled:cursor-wait',
            focusRing,
          )}
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
          ) : imageUrl ? (
            <>
              <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              <span className="absolute inset-0 flex items-center justify-center bg-ink/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
                <Camera className="h-5 w-5 text-white" aria-hidden="true" />
              </span>
            </>
          ) : (
            <Camera
              className="h-6 w-6 text-ink-4 transition-colors duration-150 group-hover:text-accent"
              aria-hidden="true"
            />
          )}
        </button>
        {imageUrl && onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Удалить: ${accessibleName}`}
            className={cn(
              'absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-bad text-white shadow-sm',
              'transition-colors duration-150 hover:bg-bad-text',
              focusRing,
            )}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        {fileInput}
      </div>
    );
  }

  // Product variant
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        aria-label={imageUrl ? `Заменить: ${accessibleName}` : `Загрузить: ${accessibleName}`}
        aria-busy={uploading || undefined}
        className={cn(
          'group relative flex aspect-square w-full max-w-[160px] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border-2 border-dashed border-line-strong bg-surface-2',
          'transition-colors duration-150 hover:border-accent disabled:cursor-wait',
          focusRing,
        )}
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-accent" aria-hidden="true" />
        ) : imageUrl ? (
          <>
            <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
            <span className="absolute inset-0 flex items-center justify-center bg-ink/40 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
              <Camera className="h-6 w-6 text-white" aria-hidden="true" />
            </span>
          </>
        ) : (
          <>
            <ImageIcon
              className="h-8 w-8 text-ink-4 transition-colors duration-150 group-hover:text-accent"
              aria-hidden="true"
            />
            <span className="text-xs text-ink-3 group-hover:text-accent-text">Добавить фото</span>
          </>
        )}
      </button>
      {imageUrl && onClear && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="mt-1.5 text-bad-text hover:bg-bad-soft hover:text-bad-text"
        >
          Удалить фото
        </Button>
      )}
      {fileInput}
    </div>
  );
}
