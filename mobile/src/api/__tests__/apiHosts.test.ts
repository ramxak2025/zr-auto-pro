/**
 * Тесты failover-кольца (инцидент 05.07: резерв без /api → 405 на POST и
 * HTML-вместо-JSON на GET, битая база запоминалась). Пины:
 *   1) голый origin в apiFallbackUrls наследует API-путь primary;
 *   2) уже раскатанные битые конфиги самолечатся (главный кейс);
 *   3) HTML-ответ на /api-запрос детектится как чужой апстрим.
 */
import { apiPathOf, buildApiHosts, isHtmlApiPayload, normalizeReserveApiBase } from '../apiHosts';

const PRIMARY = 'https://autexa-cloud.ru/api';

describe('apiPathOf', () => {
  it('извлекает /api из полной базы', () => {
    expect(apiPathOf('https://autexa-cloud.ru/api')).toBe('/api');
  });
  it('пустой путь и корень → ""', () => {
    expect(apiPathOf('https://autexa.pw')).toBe('');
    expect(apiPathOf('https://autexa.pw/')).toBe('');
  });
  it('нестандартный путь сохраняется', () => {
    expect(apiPathOf('https://x.ru/v2/api')).toBe('/v2/api');
  });
});

describe('normalizeReserveApiBase — корень инцидента 05.07', () => {
  it('ГЛАВНЫЙ КЕЙС: голый origin наследует /api primary (битый конфиг самолечится)', () => {
    expect(normalizeReserveApiBase('https://autexa.pw', PRIMARY)).toBe('https://autexa.pw/api');
  });
  it('хвостовые слэши срезаются до наследования', () => {
    expect(normalizeReserveApiBase('https://autexa.pw///', PRIMARY)).toBe('https://autexa.pw/api');
  });
  it('полная база уважается как есть', () => {
    expect(normalizeReserveApiBase('https://autexa.pw/api', PRIMARY)).toBe('https://autexa.pw/api');
  });
  it('мусор отбрасывается', () => {
    expect(normalizeReserveApiBase('', PRIMARY)).toBeNull();
    expect(normalizeReserveApiBase('not a url', PRIMARY)).toBeNull();
    expect(normalizeReserveApiBase(42, PRIMARY)).toBeNull();
    expect(normalizeReserveApiBase(null, PRIMARY)).toBeNull();
  });
});

describe('buildApiHosts', () => {
  it('primary всегда первый; резервы нормализованы; дубли отброшены', () => {
    expect(buildApiHosts(PRIMARY, ['https://autexa.pw', 'https://autexa.pw/api', PRIMARY])).toEqual([
      PRIMARY,
      'https://autexa.pw/api',
    ]);
  });
  it('пустой/кривой список → кольцо из одного primary (инертность)', () => {
    expect(buildApiHosts(PRIMARY, [])).toEqual([PRIMARY]);
    expect(buildApiHosts(PRIMARY, undefined)).toEqual([PRIMARY]);
    expect(buildApiHosts(PRIMARY, 'oops')).toEqual([PRIMARY]);
  });
});

describe('isHtmlApiPayload — HTML-страж', () => {
  it('SPA-HTML по content-type', () => {
    expect(isHtmlApiPayload('<!doctype html><html>…', 'text/html; charset=utf-8')).toBe(true);
  });
  it('HTML-строка без content-type (捕captive-portal без заголовков)', () => {
    expect(isHtmlApiPayload('  <HTML><body>login</body>', undefined)).toBe(true);
    expect(isHtmlApiPayload('<!DOCTYPE html>', '')).toBe(true);
  });
  it('нормальный JSON-объект/массив/строка не трогаются', () => {
    expect(isHtmlApiPayload({ ok: true }, 'application/json')).toBe(false);
    expect(isHtmlApiPayload([1, 2], 'application/json; charset=utf-8')).toBe(false);
    expect(isHtmlApiPayload('строка-данные', 'application/json')).toBe(false);
    expect(isHtmlApiPayload(null, undefined)).toBe(false);
  });
  it('строка со сравнением «a < b» не считается HTML', () => {
    expect(isHtmlApiPayload('a < b', 'application/json')).toBe(false);
  });
});
