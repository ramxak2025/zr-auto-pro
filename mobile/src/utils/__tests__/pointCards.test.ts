/**
 * Tests for shared/utils/pointCards.ts — сборка карточек раздела «Филиалы»,
 * общая для мобилки и веба.
 *
 * ЦЕНА ОШИБКИ ЗДЕСЬ — расхождение денег на глазах у владельца: карточки
 * филиалов обязаны в сумме давать итог сети с главной. Пока список строился по
 * одному лишь GET /points (там только живые точки), деньги закрытого филиала
 * оставались в итогах тенанта, а карточки для них не было.
 */
import { buildPointCardRows } from '../../../../shared/utils/pointCards';
import type { PointSummary, TenantPoint } from '../../../../shared/types';

function point(over: Partial<TenantPoint> & { id: string; name: string }): TenantPoint {
  return {
    sortOrder: 0,
    isActive: true,
    isMain: false,
    ...over,
  };
}

function summary(over: Partial<PointSummary> & { pointId: string; name: string }): PointSummary {
  return {
    isMain: false,
    isArchived: false,
    revenueToday: 0,
    revenueMonth: 0,
    profitMonth: 0,
    checksToday: 0,
    checksMonth: 0,
    mastersOnShift: null,
    ...over,
  };
}

describe('buildPointCardRows', () => {
  it('тенант без точек — пустой список', () => {
    expect(buildPointCardRows({ points: [], summary: [] })).toEqual([]);
  });

  it('без сводки (нет права на деньги) — карточки по живым точкам, порядок сервера', () => {
    const rows = buildPointCardRows({
      points: [
        point({ id: 'main', name: 'Autexa', isMain: true }),
        point({ id: 'b1', name: 'Филиал на Ленина' }),
        point({ id: 'b2', name: 'Филиал на Мира' }),
      ],
      summary: [],
    });

    expect(rows.map((r) => r.pointId)).toEqual(['main', 'b1', 'b2']);
    expect(rows.every((r) => r.summary === null)).toBe(true);
    expect(rows.every((r) => !r.isArchived)).toBe(true);
  });

  it('ничего не закрыто — порядок и состав ровно как в живом списке', () => {
    const points = [point({ id: 'main', name: 'Autexa', isMain: true }), point({ id: 'b1', name: 'Филиал на Ленина' })];
    const rows = buildPointCardRows({
      points,
      summary: [
        summary({ pointId: 'main', name: 'Autexa', isMain: true, revenueMonth: 100 }),
        summary({ pointId: 'b1', name: 'Филиал на Ленина', revenueMonth: 50 }),
      ],
    });

    expect(rows.map((r) => r.pointId)).toEqual(['main', 'b1']);
    expect(rows.map((r) => r.isArchived)).toEqual([false, false]);
    expect(rows[0].point).toBe(points[0]);
    expect(rows[1].summary?.revenueMonth).toBe(50);
  });

  it('закрытый филиал из сводки добавляется карточкой — иначе его деньги пропадают с экрана', () => {
    const rows = buildPointCardRows({
      points: [point({ id: 'main', name: 'Autexa', isMain: true })],
      summary: [
        summary({ pointId: 'main', name: 'Autexa', isMain: true, revenueMonth: 100 }),
        summary({ pointId: 'gone', name: 'Филиал на Мира', isArchived: true, revenueMonth: 40 }),
      ],
    });

    expect(rows.map((r) => r.pointId)).toEqual(['main', 'gone']);
    const closed = rows[1];
    expect(closed.isArchived).toBe(true);
    // Живой записи нет — войти некуда, и экран обязан это увидеть.
    expect(closed.point).toBeNull();
    expect(closed.address).toBeNull();
    expect(closed.summary?.revenueMonth).toBe(40);
    // Сумма карточек = итог сети.
    expect(rows.reduce((acc, r) => acc + (r.summary?.revenueMonth ?? 0), 0)).toBe(140);
  });

  it('закрытые уходят в хвост, порядок живых не меняется', () => {
    const rows = buildPointCardRows({
      points: [point({ id: 'main', name: 'Autexa', isMain: true }), point({ id: 'b1', name: 'Филиал на Ленина' })],
      summary: [
        summary({ pointId: 'main', name: 'Autexa', isMain: true }),
        summary({ pointId: 'zzz', name: 'Первый закрытый', isArchived: true, revenueMonth: 10 }),
        summary({ pointId: 'b1', name: 'Филиал на Ленина' }),
        summary({ pointId: 'aaa', name: 'Второй закрытый', isArchived: true, revenueMonth: 20 }),
      ],
    });

    expect(rows.map((r) => r.pointId)).toEqual(['main', 'b1', 'zzz', 'aaa']);
  });

  it('точка сессии, закрытая после входа, помечается закрытой и уезжает в хвост', () => {
    const rows = buildPointCardRows({
      points: [
        point({ id: 'main', name: 'Autexa', isMain: true }),
        // GET /points отдаёт помимо живых ещё и точку текущей сессии.
        point({ id: 'b1', name: 'Филиал на Ленина', isActive: false }),
        point({ id: 'b2', name: 'Филиал на Мира' }),
      ],
      summary: [
        summary({ pointId: 'main', name: 'Autexa', isMain: true }),
        summary({ pointId: 'b1', name: 'Филиал на Ленина', isArchived: true }),
        summary({ pointId: 'b2', name: 'Филиал на Мира' }),
      ],
    });

    expect(rows.map((r) => r.pointId)).toEqual(['main', 'b2', 'b1']);
    expect(rows[2].isArchived).toBe(true);
    // Подробности живой записи при этом сохранены — карточка не обеднела.
    expect(rows[2].point?.id).toBe('b1');
  });

  it('без сводки признак закрытости берётся из isActive живой записи', () => {
    const rows = buildPointCardRows({
      points: [
        point({ id: 'main', name: 'Autexa', isMain: true }),
        point({ id: 'b1', name: 'Филиал на Ленина', isActive: false }),
      ],
      summary: [],
    });

    expect(rows.map((r) => r.pointId)).toEqual(['main', 'b1']);
    expect(rows.map((r) => r.isArchived)).toEqual([false, true]);
  });

  it('адрес и состав берутся из живой записи', () => {
    const rows = buildPointCardRows({
      points: [point({ id: 'b1', name: 'Филиал на Ленина', address: 'Ленина, 1', memberIds: ['u1', 'u2'] })],
      summary: [],
    });

    expect(rows[0].address).toBe('Ленина, 1');
    expect(rows[0].point?.memberIds).toEqual(['u1', 'u2']);
  });
});
