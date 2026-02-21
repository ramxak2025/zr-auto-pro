import { useState, useRef } from 'react';
import { Camera, Loader2, X, ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { uploadsApi } from '../api/services';

interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onClear?: () => void;
  variant?: 'avatar' | 'product';
  className?: string;
}

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ACCEPTED = 'image/jpeg,image/png,image/webp,image/heic';

export default function ImageUpload({
  value,
  onChange,
  onClear,
  variant = 'product',
  className = '',
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (file.size > MAX_SIZE) {
      toast.error('Файл слишком большой (макс 5 МБ)');
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

  if (variant === 'avatar') {
    return (
      <div className={`relative inline-block ${className}`}>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="relative w-20 h-20 rounded-2xl overflow-hidden bg-gray-100 border-2 border-dashed border-gray-300 hover:border-primary-400 transition-colors flex items-center justify-center group"
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          ) : imageUrl ? (
            <>
              <img src={imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Camera className="h-5 w-5 text-white" />
              </div>
            </>
          ) : (
            <Camera className="h-6 w-6 text-gray-400 group-hover:text-primary-500 transition-colors" />
          )}
        </button>
        {imageUrl && onClear && (
          <button
            type="button"
            onClick={onClear}
            className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center shadow-sm hover:bg-red-600 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          onChange={handleChange}
          className="hidden"
        />
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
        className="relative w-full aspect-square max-w-[160px] rounded-xl overflow-hidden bg-gray-50 border-2 border-dashed border-gray-200 hover:border-primary-400 transition-colors flex flex-col items-center justify-center gap-1.5 group"
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        ) : imageUrl ? (
          <>
            <img src={imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Camera className="h-6 w-6 text-white" />
            </div>
          </>
        ) : (
          <>
            <ImageIcon className="h-8 w-8 text-gray-300 group-hover:text-primary-400 transition-colors" />
            <span className="text-[11px] text-gray-400 group-hover:text-primary-500">Добавить фото</span>
          </>
        )}
      </button>
      {imageUrl && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="mt-1.5 text-xs text-red-500 hover:text-red-600"
        >
          Удалить фото
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        onChange={handleChange}
        className="hidden"
      />
    </div>
  );
}
