import { ImagePlus, Trash2 } from 'lucide-react';
type Field = 'logoUrl' | 'backgroundImageUrl';
export default function BookingBrandingEditor({
  logoUrl,
  backgroundImageUrl,
  uploading,
  onUpload,
  onRemove,
}: {
  logoUrl?: string | null;
  backgroundImageUrl?: string | null;
  uploading: Field | null;
  onUpload: (field: Field, file: File) => void;
  onRemove: (field: Field) => void;
}) {
  return (
    <div className="booking-branding-editor">
      {(
        [
          ['logoUrl', 'Логотип сервиса', logoUrl],
          ['backgroundImageUrl', 'Изображение шапки', backgroundImageUrl],
        ] as const
      ).map(([field, label, url]) => (
        <div key={field} className="booking-branding-row">
          <div className={`booking-branding-preview ${field === 'logoUrl' ? 'is-logo' : ''}`}>
            {url ? <img src={url} alt={label} /> : <ImagePlus size={24} aria-hidden="true" />}
          </div>
          <div>
            <strong>{label}</strong>
            <p>JPEG, PNG или WebP · до 5 МБ</p>
            <label className="booking-branding-upload">
              {uploading === field ? 'Загружаем…' : url ? 'Заменить' : 'Загрузить'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={!!uploading}
                aria-label={label}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) onUpload(field, file);
                }}
              />
            </label>
            {url && (
              <button type="button" disabled={!!uploading} onClick={() => onRemove(field)}>
                <Trash2 size={14} aria-hidden="true" />
                Удалить
              </button>
            )}
          </div>
        </div>
      ))}
      <p className="booking-branding-note">Изображения появятся у клиентов после сохранения настроек.</p>
    </div>
  );
}
