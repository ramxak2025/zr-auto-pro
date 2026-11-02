import { BadRequestException } from '@nestjs/common';

/** Shared by product reads, writes and the public projection. */
export function productPhotos(photos: unknown, legacyPhoto?: unknown): string[] {
  if (Array.isArray(photos) && photos.length)
    return photos.filter((p): p is string => typeof p === 'string' && !!p.trim());
  return typeof legacyPhoto === 'string' && legacyPhoto.trim() ? [legacyPhoto.trim()] : [];
}

export function validateProductPhotos(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 4 || value.some((p) => typeof p !== 'string' || !p.trim())) {
    throw new BadRequestException({ message: 'Добавьте не более четырёх фотографий' });
  }
  const photos = value.map((p: string) => p.trim());
  if (new Set(photos).size !== photos.length)
    throw new BadRequestException({ message: 'Фотографии не должны повторяться' });
  return photos;
}
