/**
 * Тесты resolveCheckDetailState — защита от регрессии бага «пустой экран»
 * после «Принять оплату» / «Продолжить» по отложенному чеку.
 *
 * Самые важные ветки:
 *   - content при наличии чека (stale-while-revalidate) — даже при ошибке
 *     фонового рефетча экран НЕ должен блекнуть;
 *   - error при провале первой загрузки без кеша → показываем retry, а не
 *     пустой <Text>;
 *   - notfound при успешном пустом ответе → полноэкранный empty-state.
 */
import { resolveCheckDetailState, type CheckDetailStateInput } from '../checkDetailViewState';

// База: ничего не грузится, ошибок нет, чека нет.
const base: CheckDetailStateInput = {
  hasCheck: false,
  isLoading: false,
  isError: false,
};

describe('resolveCheckDetailState', () => {
  describe('hasCheck gate (stale-while-revalidate)', () => {
    it('есть чек → content, даже если идёт загрузка (фоновый рефетч)', () => {
      expect(resolveCheckDetailState({ ...base, hasCheck: true, isLoading: true })).toBe('content');
    });

    it('есть чек → content, даже если последний рефетч упал', () => {
      // Ключевая ветка: принятие оплаты инициирует рефетч; если он
      // транзиентно ошибётся, но в кеше есть прошлый чек — НЕ блекнем.
      expect(resolveCheckDetailState({ ...base, hasCheck: true, isError: true })).toBe('content');
    });

    it('есть чек, всё спокойно → content', () => {
      expect(resolveCheckDetailState({ ...base, hasCheck: true })).toBe('content');
    });
  });

  describe('нет чека', () => {
    it('первая загрузка в полёте → loading', () => {
      expect(resolveCheckDetailState({ ...base, isLoading: true })).toBe('loading');
    });

    it('загрузка упала, кеша нет → error (а не пустой экран)', () => {
      expect(resolveCheckDetailState({ ...base, isError: true })).toBe('error');
    });

    it('успешный пустой ответ (чек удалён) → notfound', () => {
      expect(resolveCheckDetailState(base)).toBe('notfound');
    });
  });

  describe('приоритет ветвей', () => {
    it('hasCheck перебивает и loading, и error одновременно', () => {
      expect(resolveCheckDetailState({ hasCheck: true, isLoading: true, isError: true })).toBe('content');
    });

    it('loading перебивает error, когда чека нет', () => {
      expect(resolveCheckDetailState({ hasCheck: false, isLoading: true, isError: true })).toBe('loading');
    });
  });
});
