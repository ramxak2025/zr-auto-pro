/**
 * Idempotency guards for the license-plate INPUT pipeline.
 *
 * These back the RussianPlateInput fix for the intermittent «нажимаешь одну
 * букву, а вводится другая» bug. The component now keeps a decoupled local
 * buffer and re-feeds its own formatted value on every keystroke and on
 * every external resync. If any of the round-trips below stopped being an
 * identity, a stale/echoed value could mutate a character or shift the caret
 * — exactly the class of defect we are fixing.
 *
 * plateMask.ts logic is NOT modified; this file only pins the invariants the
 * component relies on.
 */
import {
  processPlateMainInput,
  processPlateRegionInput,
  processPlateInput,
  combinePlate,
  splitPlate,
  formatMain,
  formatPlateDisplay,
} from '../plateMask';

// Clean MAIN buffers the component can hold (already normalized, ≤ 6 chars).
const MAIN_SAMPLES = ['', 'А', 'А1', 'А12', 'А123', 'А123А', 'А123АА', 'О999НН', 'К007КК'];
// Clean full plates (main + 2-3 digit region).
const FULL_SAMPLES = ['А123АА77', 'А123АА177', 'О999НН12', 'Т007ТТ199', 'Р332РА05'];

describe('MAIN buffer round-trip is an identity', () => {
  // formatMain adds ГОСТ spaces; the component strips them and re-normalizes.
  // Feeding the just-formatted value back must return the exact same buffer,
  // otherwise a re-render / echoed prop could rewrite a character.
  it.each(MAIN_SAMPLES)('processPlateMainInput(formatMain(%p) stripped) === input', (x) => {
    const stripped = formatMain(x).replace(/\s/g, '');
    expect(processPlateMainInput(stripped)).toBe(x);
  });

  it('processPlateMainInput is idempotent under repeated application', () => {
    for (const x of MAIN_SAMPLES) {
      const once = processPlateMainInput(x);
      expect(processPlateMainInput(once)).toBe(once);
    }
  });

  it('re-applying a STALE already-normalized value does not mutate it', () => {
    // Simulates the heavy-parent round-trip: the component emits a clean main,
    // the parent echoes it back late, native re-sends the formatted string.
    let buffer = 'А123АА';
    for (let i = 0; i < 5; i++) {
      buffer = processPlateMainInput(formatMain(buffer).replace(/\s/g, ''));
    }
    expect(buffer).toBe('А123АА');
  });
});

describe('REGION buffer round-trip is an identity', () => {
  it.each(['', '7', '77', '177', '05'])('processPlateRegionInput(%p) is stable', (r) => {
    const once = processPlateRegionInput(r);
    expect(processPlateRegionInput(once)).toBe(once);
    expect(once).toBe(r); // digit-only ≤3 inputs pass through untouched
  });
});

describe('split → combine round-trip (external resync path)', () => {
  // On an external value change the component does splitPlate(value) into two
  // local buffers, then emits combinePlate(main, region). That must reproduce
  // the original clean string byte-for-byte.
  it.each(FULL_SAMPLES)('combinePlate(splitPlate(%p)) === input', (p) => {
    const { main, region } = splitPlate(p);
    expect(combinePlate(main, region)).toBe(p);
  });

  it.each(FULL_SAMPLES)('full-plate reformat round-trip is an identity for %p', (p) => {
    const stripped = formatPlateDisplay(p).replace(/\s/g, '');
    expect(processPlateInput(stripped)).toBe(p);
  });
});

describe('deterministic caret lands at end (cursor-jump guard)', () => {
  // The component pins the caret to formatMain(cleanMain).length after every
  // keystroke. That is only safe because latin→cyrillic mapping is 1-char →
  // 1-char (never grows/shrinks or reorders), so the caret can never overtake
  // or fall behind a freshly typed character. Guard that invariant here.
  const caretAfterType = (nativeText: string) => {
    const raw = nativeText.replace(/\s/g, '');
    const cleanMain = processPlateMainInput(raw);
    const display = formatMain(cleanMain);
    return { display, caret: display.length };
  };

  it('single latin char maps to one cyrillic char, caret at end', () => {
    const { display, caret } = caretAfterType('a');
    expect(display).toBe('А');
    expect(caret).toBe(1);
  });

  it('typing a full latin plate keeps caret at the end of the formatted text', () => {
    // Emulates native appending each char; caret must always equal display end.
    const sequence = ['a', 'a1', 'a12', 'a123', 'a123b', 'a123bc'];
    const expected = ['А', 'А 1', 'А 12', 'А 123', 'А 123 В', 'А 123 ВС'];
    sequence.forEach((native, i) => {
      const { display, caret } = caretAfterType(native);
      expect(display).toBe(expected[i]);
      expect(caret).toBe(display.length);
    });
  });

  it('backspace keeps caret at end of the shortened text', () => {
    const { display, caret } = caretAfterType('А 123 А'); // one char removed
    expect(display).toBe('А 123 А');
    expect(caret).toBe(display.length);
  });
});

describe('resync guard tolerates in-flight parent echo (jumping-letter guard)', () => {
  // Faithful model of RussianPlateInput's decoupled buffer + emit ring.
  //
  // The parent (setPlateSearch) is a pure pass-through: every emitted value is
  // echoed back into `value`, but may lag several keystrokes behind. A
  // single-slot guard (remember only the LAST emit) mistakes the echo of an
  // earlier, still-in-flight emit for an external change and resyncs the buffer
  // to a stale value — the intermittent «прыгающая буква». The ring guard
  // recognises ANY still-in-flight self-emit and prunes it once its echo passes,
  // while still resyncing on a genuinely external value.
  type State = { buffer: string; ring: string[] };

  // emit(): local buffer moves instantly; value is recorded as in-flight.
  const emit = (s: State, next: string): State => {
    const ring = [...s.ring, next];
    if (ring.length > 16) ring.shift();
    return { buffer: next, ring };
  };

  // receive(): mirrors the useEffect([value]) body exactly.
  const receive = (s: State, value: string): State => {
    const idx = s.ring.indexOf(value);
    if (idx !== -1) {
      // Echo of one of our own emits — prune it (and everything it superseded),
      // never touch the buffer.
      return { buffer: s.buffer, ring: s.ring.slice(idx + 1) };
    }
    // Genuinely external value — resync the buffer, drop stale in-flight emits.
    return { buffer: value, ring: [] };
  };

  it('lagging in-order echoes never clobber the ahead buffer', () => {
    let s: State = { buffer: '', ring: [''] };
    // three keystrokes emitted before the parent echoes anything back
    s = emit(s, 'А');
    s = emit(s, 'А1');
    s = emit(s, 'А12');
    expect(s.buffer).toBe('А12');
    // parent now replays the emits, in order, LATE
    s = receive(s, 'А'); // stale echo — must NOT resync to 'А'
    expect(s.buffer).toBe('А12');
    s = receive(s, 'А1'); // stale echo
    expect(s.buffer).toBe('А12');
    s = receive(s, 'А12'); // caught up
    expect(s.buffer).toBe('А12');
    expect(s.ring).toEqual([]);
  });

  it('the echo of a stale in-flight emit is a no-op on the ahead buffer', () => {
    // Round-trip: the buffer has already advanced to a full plate while an
    // earlier partial is still echoing. Applying that stale echo must not
    // rewrite a character.
    let s: State = { buffer: '', ring: [''] };
    s = emit(s, 'А123АА');
    s = emit(s, 'А123АА77');
    s = receive(s, 'А123АА'); // echo of the earlier emit
    expect(s.buffer).toBe('А123АА77');
  });

  it('a genuinely external value (X clear) resyncs the buffer', () => {
    let s: State = { buffer: '', ring: [''] };
    s = emit(s, 'А123АА77');
    s = receive(s, 'А123АА77'); // echo settles, ring drains
    expect(s.ring).toEqual([]);
    s = receive(s, ''); // X clear — never emitted → external
    expect(s.buffer).toBe('');
  });

  it('a selected car plate we never emitted resyncs the buffer', () => {
    // Even mid-flight, picking a client/car pushes a value we did not type.
    let s: State = { buffer: 'А1', ring: ['А', 'А1'] };
    s = receive(s, 'О999НН12');
    expect(s.buffer).toBe('О999НН12');
    expect(s.ring).toEqual([]);
  });
});
