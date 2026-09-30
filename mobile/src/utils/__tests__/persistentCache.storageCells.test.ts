/**
 * Ячейки хранения (2026-09-30) в персистентном кеше: справочник ячеек склада
 * поднимается на холодном старте, пустой снимок — нет, число слотов ограничено.
 * Только чистые хелперы — тест идёт в node-окружении jest, как соседние.
 */
import { classifyStoredPair, VARIANT_CAPS, PERSISTED_KEYS, type StoredEntry } from '../persistentCache.helpers';

const NOW = 1_700_000_000_000;

function serialise(entry: StoredEntry): string {
  return JSON.stringify(entry);
}

describe("persistent cache: ['storage-cells', warehouseId]", () => {
  const cell = { id: 'c1', warehouseId: 'w1', code: 'A-1-1', name: null, sortOrder: 0, productsCount: 3 };

  it('находится в whitelist', () => {
    expect(PERSISTED_KEYS).toContain('storage-cells');
  });

  it('свежий непустой список ячеек склада — ok, storedAt сохранён', () => {
    const storedAt = NOW - 5_000;
    const res = classifyStoredPair(serialise({ queryKey: ['storage-cells', 'w1'], data: [cell], storedAt }), NOW);
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.first).toBe('storage-cells');
      expect(res.storedAt).toBe(storedAt);
    }
  });

  it('склад без ячеек (пустой массив) не воскрешается — иначе маскировал бы появившиеся ячейки', () => {
    const res = classifyStoredPair(serialise({ queryKey: ['storage-cells', 'w1'], data: [], storedAt: NOW }), NOW);
    expect(res.status).toBe('skip');
  });

  it('примитив вместо списка (HTML при 502) — corrupt', () => {
    const res = classifyStoredPair(
      serialise({ queryKey: ['storage-cells', 'w1'], data: '<html>502</html>', storedAt: NOW }),
      NOW,
    );
    expect(res.status).toBe('corrupt');
  });

  it('число слотов ограничено — по слоту на склад плюс запасной', () => {
    expect(VARIANT_CAPS['storage-cells']).toBe(4);
  });
});
