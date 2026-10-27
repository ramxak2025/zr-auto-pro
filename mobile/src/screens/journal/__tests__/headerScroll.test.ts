import { initialJournalScrollState, nextJournalScrollState } from '../headerScroll';
it('condenses only after deliberate travel and expands on reverse travel without jitter', () => {
  let state = initialJournalScrollState();
  for (const y of [10, 24, 50, 79]) {
    state = nextJournalScrollState(state, y, false);
    expect(state.compact).toBe(false);
  }
  state = nextJournalScrollState(state, 120, false);
  expect(state.compact).toBe(true);
  for (const y of [118, 116, 119, 115]) {
    state = nextJournalScrollState(state, y, false);
    expect(state.compact).toBe(true);
  }
  state = nextJournalScrollState(state, 75, false);
  expect(state.compact).toBe(false);
});
it('search focus pins context open and overscroll bounce cannot hide it', () => {
  let state = nextJournalScrollState(initialJournalScrollState(), 200, false);
  expect(state.compact).toBe(true);
  state = nextJournalScrollState(state, 400, true);
  expect(state.compact).toBe(false);
  state = nextJournalScrollState(state, -30, false);
  expect(state.y).toBe(0);
  expect(state.compact).toBe(false);
});
