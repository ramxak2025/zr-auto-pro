import {
  productPhotoUrls,
  productPhotoPatch,
  moveProductPhoto,
  uploadProductPhotos,
} from '../../../../shared/utils/productPhotos';

it('keeps a legacy cover, ordered four-photo bounds and removal/cover promotion', () => {
  expect(productPhotoUrls({ photo: ' /legacy.jpg ' })).toEqual(['/legacy.jpg']);
  const photos = ['/a', '/b', '/c', '/d'];
  expect(productPhotoUrls({ photos: [...photos, '/e'] })).toEqual(photos);
  expect(productPhotoPatch(moveProductPhoto(photos, 2, 0))).toEqual({ photo: '/c', photos: ['/c', '/a', '/b', '/d'] });
  expect(productPhotoPatch(photos.slice(1))).toEqual({ photo: '/b', photos: ['/b', '/c', '/d'] });
  expect(productPhotoPatch([])).toEqual({ photos: [], photo: null });
});

it('uploads local images in order, retains server URLs and stops a stale continuation', async () => {
  const upload = jest.fn(async (uri: string) => `/uploaded/${uri.split('/').pop()}`);
  expect(await uploadProductPhotos(['/existing', 'file:///a.jpg', 'content:///b.jpg'], upload, () => true)).toEqual([
    '/existing',
    '/uploaded/a.jpg',
    '/uploaded/b.jpg',
  ]);
  expect(upload.mock.calls.map(([uri]) => uri)).toEqual(['file:///a.jpg', 'content:///b.jpg']);
  let current = true;
  upload.mockImplementationOnce(async () => {
    current = false;
    return '/old-session';
  });
  expect(await uploadProductPhotos(['file:///late.jpg', 'file:///never.jpg'], upload, () => current)).toBeNull();
  expect(upload).not.toHaveBeenCalledWith('file:///never.jpg');
  await expect(uploadProductPhotos(['a', 'b', 'c', 'd', 'e'], upload, () => true)).rejects.toThrow('четырёх');
});
