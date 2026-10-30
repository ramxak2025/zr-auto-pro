import { ownerTimelineReadoutLabel } from '../ownerHomeTimelineReadout';
import { ownerTimelineModel } from '../ownerHomeTimelineModel';
import { timelineFixture } from '../__fixtures__/timeline';

test('visual date/hour captions omit ordinary UTC offsets and the redundant year', () => {
  const data = timelineFixture(),
    model = ownerTimelineModel(data, 'day')!;
  expect(ownerTimelineReadoutLabel(data, model, model.points[0])).toBe('29 октября · 00:00–01:00');
  expect(ownerTimelineReadoutLabel(data, model, model.points.at(-1)!)).toBe('29 октября · 14:00–14:20');
  expect(model.points[0].label).toContain('2026');
  expect(model.points[0].label).toContain('UTC+03:00');
});

test('daily and monthly captions show the selected interval including a partial month', () => {
  const week = timelineFixture('week'),
    days = ownerTimelineModel(week, 'week')!;
  expect(ownerTimelineReadoutLabel(week, days, days.points[0])).toBe('26 октября');
  const year = timelineFixture('year'),
    months = ownerTimelineModel(year, 'year')!;
  expect(ownerTimelineReadoutLabel(year, months, months.points[0])).toBe('январь');
  expect(ownerTimelineReadoutLabel(year, months, months.points.at(-1)!)).toBe('октябрь · 1–29');
});

test('repeated DST hours keep the offsets needed to distinguish the actual intervals', () => {
  const original = timelineFixture(),
    model = ownerTimelineModel(original, 'day')!;
  const data = { ...original, timezone: 'Europe/Berlin' };
  const first = {
    ...model.points[0],
    at: '2026-10-25T00:00:00Z',
    untilExclusive: '2026-10-25T01:00:00Z',
    localDate: '2026-10-25',
  };
  const second = {
    ...model.points[1],
    at: '2026-10-25T01:00:00Z',
    untilExclusive: '2026-10-25T02:00:00Z',
    localDate: '2026-10-25',
  };
  const repeated = { ...model, points: [first, second] };
  expect(ownerTimelineReadoutLabel(data, repeated, first)).toBe('25 октября · 02:00 UTC+02:00–02:00 UTC+01:00');
  expect(ownerTimelineReadoutLabel(data, repeated, second)).toBe('25 октября · 02:00–03:00 UTC+01:00');
});

test('a final midnight boundary reads 24:00 and an opening-only point reads its exact clock', () => {
  const data = timelineFixture(),
    model = ownerTimelineModel(data, 'day')!;
  const last = { ...model.points[0], at: '2026-10-29T20:00:00Z', untilExclusive: '2026-10-29T21:00:00Z' };
  expect(ownerTimelineReadoutLabel(data, model, last)).toBe('29 октября · 23:00–24:00');
  const opening = { ...model.points[0], untilExclusive: model.points[0].at };
  expect(ownerTimelineReadoutLabel(data, model, opening)).toBe('29 октября · 00:00');
});
