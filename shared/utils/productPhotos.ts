export const MAX_PRODUCT_PHOTOS = 4;

/** Ordered photos; the first image remains the legacy cover for older clients. */
export function productPhotoUrls(product: { photos?: readonly string[]; photo?: string | null }): string[] {
  const source = product.photos?.length ? product.photos : product.photo ? [product.photo] : [];
  return [...new Set(source.map((url) => url.trim()).filter(Boolean))].slice(0, MAX_PRODUCT_PHOTOS);
}

export function moveProductPhoto(photos: readonly string[], from: number, to: number): string[] {
  const next = [...photos];
  if (from < 0 || to < 0 || from >= next.length || to >= next.length) return next;
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function productPhotoPatch(photos: readonly string[]): { photos: string[]; photo: string | null } {
  const next = productPhotoUrls({ photos });
  return { photos: next, photo: next[0] ?? null };
}

/** Sequential local uploads keep ordering and stop when the owning form/session changes. */
export async function uploadProductPhotos(
  photos: readonly string[],
  upload: (uri: string) => Promise<string>,
  isCurrent: () => boolean,
): Promise<string[] | null> {
  if (photos.length > MAX_PRODUCT_PHOTOS) throw new Error('Добавьте не более четырёх фотографий.');
  const result: string[] = [];
  for (const uri of photos) {
    if (!isCurrent()) return null;
    const url = /^(?:file|content):/.test(uri) ? await upload(uri) : uri;
    if (!isCurrent()) return null;
    result.push(url);
  }
  return isCurrent() ? result : null;
}
