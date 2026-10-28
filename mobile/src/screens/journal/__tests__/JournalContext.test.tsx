jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useState: (value: unknown) => [value, jest.fn()],
  useEffect: jest.fn(),
}));
jest.mock('react-native', () => ({ StyleSheet: { create: (value: unknown) => value } }));
jest.mock('../../../platform/Typography', () => ({ Text: 'Text' }));
jest.mock('../../../contexts/ThemeContext', () => ({ useColors: () => ({ text: { secondary: '#475569' } }) }));
import JournalContext, { journalFreshnessState } from '../JournalContext';
const query = (dataUpdatedAt: number, isFetching = false, isLoading = false) => ({
  dataUpdatedAt,
  isFetching,
  isLoading,
});
it('uses the oldest nonzero product/warehouse timestamp and any background fetch', () => {
  expect(journalFreshnessState([query(900), query(400), query(0)])).toEqual({ refreshing: false, lastUpdated: 400 });
  expect(journalFreshnessState([query(900), query(400, true)])).toEqual({ refreshing: true, lastUpdated: 400 });
  expect(journalFreshnessState([query(0, true, true), query(900)])).toEqual({ refreshing: false, lastUpdated: 900 });
});
it('renders only freshness, with no empty context row when no timestamp exists', () => {
  expect(JournalContext({ queries: [query(0)] })).toBeNull();
  expect(JournalContext({ queries: [query(900), query(400, true)] })?.props.children).toBe('Обновляется…');
  expect(JournalContext({ query: query(Date.now()) })?.props.children).toBe('Обновлено только что');
});
