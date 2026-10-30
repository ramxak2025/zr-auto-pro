import { useOwnerHomeCloudEntrance } from '../useOwnerHomeCloudEntrance';

type Effect = { deps: readonly unknown[]; cleanup?: () => void };
const mockRefs: { current: unknown }[] = [];
const mockValues: { value: number }[] = [];
const mockEffects: Effect[] = [];
const mockPendingEffects: (() => void)[] = [];
const mockTiming = jest.fn((value: number, _config: unknown) => value);
const mockDelay = jest.fn((_duration: number, animation: number, _reduceMotion: unknown) => animation);
const mockCancel = jest.fn();
let mockRefIndex = 0;
let mockValueIndex = 0;
let mockEffectIndex = 0;
let mockStyle: () => unknown;

jest.mock('react', () => ({
  useRef: (initial: unknown) => {
    const index = mockRefIndex++;
    return mockRefs[index] ?? (mockRefs[index] = { current: initial });
  },
  useLayoutEffect: (create: () => () => void, deps: readonly unknown[]) => {
    const index = mockEffectIndex++;
    const previous = mockEffects[index];
    if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps[offset]))) {
      mockPendingEffects.push(() => {
        previous?.cleanup?.();
        mockEffects[index] = { deps, cleanup: create() };
      });
    }
  },
}));
jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial: number) => {
    const index = mockValueIndex++;
    return mockValues[index] ?? (mockValues[index] = { value: initial });
  },
  useAnimatedStyle: (factory: () => unknown) => {
    mockStyle = factory;
    return factory();
  },
  withTiming: (value: number, config: unknown) => mockTiming(value, config),
  withDelay: (duration: number, animation: number, reduceMotion: unknown) =>
    mockDelay(duration, animation, reduceMotion),
  cancelAnimation: (value: unknown) => mockCancel(value),
  ReduceMotion: { System: 'system' },
  Easing: { cubic: 'cubic', out: (value: unknown) => value },
}));

type Options = Parameters<typeof useOwnerHomeCloudEntrance>[0];
function commitEffects() {
  for (const commit of mockPendingEffects.splice(0)) commit();
}
function CloudEntranceHarness(options: Partial<Options> = {}, commit = true) {
  mockRefIndex = 0;
  mockValueIndex = 0;
  mockEffectIndex = 0;
  const style = useOwnerHomeCloudEntrance({ enabled: true, reducedMotion: false, activation: 0, ...options });
  if (commit) commitEffects();
  return style;
}
function unmount() {
  for (const effect of mockEffects) effect.cleanup?.();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRefs.length = 0;
  mockValues.length = 0;
  mockEffects.length = 0;
  mockPendingEffects.length = 0;
});

test('cold entrance is prepared before the first native frame and waits for the splash exit before arriving', () => {
  mockDelay.mockReturnValueOnce(0);
  expect(CloudEntranceHarness({}, false)).toEqual({ opacity: 0, transform: [{ translateX: 180 }] });
  expect(mockTiming).not.toHaveBeenCalled();
  commitEffects();
  expect(mockTiming).toHaveBeenCalledTimes(1);
  expect(mockTiming).toHaveBeenCalledWith(1, { duration: 760, easing: 'cubic', reduceMotion: 'system' });
  expect(mockDelay).toHaveBeenCalledTimes(1);
  expect(mockDelay).toHaveBeenCalledWith(240, mockTiming.mock.results[0].value, 'system');
  expect(mockStyle()).toEqual({ opacity: 0, transform: [{ translateX: 180 }] });
  mockValues[0].value = 1;
  expect(mockStyle()).toEqual({ opacity: 1, transform: [{ translateX: 0 }] });
  CloudEntranceHarness();
  expect(mockTiming).toHaveBeenCalledTimes(1);
  expect(mockDelay).toHaveBeenCalledTimes(1);
});

test('unrelated parent renders and remounted summary children cannot reset or replay an in-flight entrance', () => {
  CloudEntranceHarness();
  mockValues[0].value = 0.5;
  // The parent retains this hook when data, period, theme, font scale, or the
  // ready/placeholder child changes; none changes its activation inputs.
  for (let update = 0; update < 5; update++) CloudEntranceHarness();
  expect(mockTiming).toHaveBeenCalledTimes(1);
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(mockStyle()).toEqual({ opacity: 0.5, transform: [{ translateX: 90 }] });
});

test('a real app activation plays once again immediately without the cold splash delay', () => {
  CloudEntranceHarness();
  mockValues[0].value = 0.3;
  CloudEntranceHarness({ enabled: false });
  expect(mockStyle()).toEqual({ opacity: 1, transform: [{ translateX: 0 }] });
  expect(mockCancel).toHaveBeenLastCalledWith(mockValues[0]);
  CloudEntranceHarness({ activation: 1 });
  CloudEntranceHarness({ activation: 1 });
  expect(mockTiming).toHaveBeenCalledTimes(2);
  expect(mockDelay).toHaveBeenCalledTimes(1);
});

test('a first eligible entrance after a resumed activation has no cold splash delay', () => {
  CloudEntranceHarness({ enabled: false });
  CloudEntranceHarness({ activation: 1 });
  expect(mockTiming).toHaveBeenCalledTimes(1);
  expect(mockDelay).not.toHaveBeenCalled();
});

test('navigation and inactive-native-sheet visibility changes cancel motion without replaying it', () => {
  CloudEntranceHarness();
  mockValues[0].value = 0.4;
  CloudEntranceHarness({ enabled: false });
  CloudEntranceHarness();
  CloudEntranceHarness({ enabled: false });
  CloudEntranceHarness();
  expect(mockTiming).toHaveBeenCalledTimes(1);
  expect(mockStyle()).toEqual({ opacity: 1, transform: [{ translateX: 0 }] });
});

test('an initially hidden screen stays static and runs its first entrance only when enabled', () => {
  expect(CloudEntranceHarness({ enabled: false }, false)).toEqual({ opacity: 1, transform: [{ translateX: 0 }] });
  commitEffects();
  expect(mockTiming).not.toHaveBeenCalled();
  expect(mockDelay).not.toHaveBeenCalled();
  CloudEntranceHarness();
  CloudEntranceHarness();
  expect(mockTiming).toHaveBeenCalledTimes(1);
  expect(mockDelay).toHaveBeenCalledTimes(1);
});

test('activations while hidden do not animate, and the latest activation plays once when visible', () => {
  CloudEntranceHarness();
  CloudEntranceHarness({ enabled: false, activation: 1 });
  CloudEntranceHarness({ enabled: false, activation: 2 });
  expect(mockTiming).toHaveBeenCalledTimes(1);
  CloudEntranceHarness({ activation: 2 });
  CloudEntranceHarness({ activation: 2 });
  expect(mockTiming).toHaveBeenCalledTimes(2);
});

test('Reduce Motion starts in the final position and consumes the activation without a later replay', () => {
  expect(CloudEntranceHarness({ reducedMotion: true }, false)).toEqual({ opacity: 1, transform: [{ translateX: 0 }] });
  commitEffects();
  CloudEntranceHarness({ reducedMotion: false });
  expect(mockTiming).not.toHaveBeenCalled();
  expect(mockDelay).not.toHaveBeenCalled();
  CloudEntranceHarness({ reducedMotion: false, activation: 1 });
  expect(mockTiming).toHaveBeenCalledTimes(1);
  expect(mockDelay).not.toHaveBeenCalled();
});

test('enabling Reduce Motion interrupts a running entrance and stays final when the preference changes back', () => {
  CloudEntranceHarness();
  mockValues[0].value = 0.25;
  mockCancel.mockClear();
  CloudEntranceHarness({ reducedMotion: true });
  expect(mockCancel).toHaveBeenCalledWith(mockValues[0]);
  expect(mockStyle()).toEqual({ opacity: 1, transform: [{ translateX: 0 }] });
  CloudEntranceHarness();
  CloudEntranceHarness({ reducedMotion: true, activation: 1 });
  CloudEntranceHarness({ activation: 1 });
  expect(mockTiming).toHaveBeenCalledTimes(1);
});

test('Reduce Motion cancels a pending cold delay and shows the cloud immediately', () => {
  mockDelay.mockReturnValueOnce(0);
  CloudEntranceHarness();
  expect(mockStyle()).toEqual({ opacity: 0, transform: [{ translateX: 180 }] });
  mockCancel.mockClear();
  CloudEntranceHarness({ reducedMotion: true });
  expect(mockCancel).toHaveBeenCalledWith(mockValues[0]);
  expect(mockStyle()).toEqual({ opacity: 1, transform: [{ translateX: 0 }] });
  CloudEntranceHarness();
  expect(mockDelay).toHaveBeenCalledTimes(1);
  expect(mockTiming).toHaveBeenCalledTimes(1);
});

test('unmount cancels the shared value that owns the full delayed entrance without scheduling another', () => {
  mockDelay.mockReturnValueOnce(0);
  CloudEntranceHarness();
  expect(mockDelay).toHaveBeenCalledTimes(1);
  expect(mockValues[0].value).toBe(mockDelay.mock.results[0].value);
  mockCancel.mockClear();
  unmount();
  expect(mockCancel).toHaveBeenCalledTimes(1);
  expect(mockCancel).toHaveBeenCalledWith(mockValues[0]);
  expect(mockTiming).toHaveBeenCalledTimes(1);
});
