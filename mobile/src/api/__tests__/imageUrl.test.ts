import { resolveImageUrl } from '../imageUrl';

describe('resolveImageUrl', () => {
  const apiBase = 'https://api.example.test/api';

  it.each([
    ['http://cdn.example.test/avatar.jpg', 'http://cdn.example.test/avatar.jpg'],
    ['https://cdn.example.test/avatar.jpg', 'https://cdn.example.test/avatar.jpg'],
    ['data:image/png;base64,abc123', 'data:image/png;base64,abc123'],
    ['/api/uploads/team/avatar.webp', 'https://api.example.test/api/uploads/team/avatar.webp'],
    ['api/uploads/team/avatar.webp', 'https://api.example.test/api/uploads/team/avatar.webp'],
  ])('keeps or resolves %s', (path, expected) => {
    expect(resolveImageUrl(path, apiBase)).toBe(expected);
  });

  it('returns undefined for missing paths', () => {
    expect(resolveImageUrl(undefined, apiBase)).toBeUndefined();
    expect(resolveImageUrl(null, apiBase)).toBeUndefined();
    expect(resolveImageUrl('', apiBase)).toBeUndefined();
  });
});
