const mockCallbacks: (() => void)[] = [];
const mockKill = jest.fn(),
  mockPlay = jest.fn();
interface MockTimeline {
  call: jest.Mock<MockTimeline, [() => void]>;
  play: jest.Mock;
  kill: jest.Mock;
}
const mockTimeline: MockTimeline = {
  call: jest.fn((callback: () => void) => {
    mockCallbacks.push(callback);
    return mockTimeline;
  }),
  play: mockPlay,
  kill: mockKill,
};
const mockCreate = jest.fn(() => mockTimeline),
  mockConfig = jest.fn();
// Jest's Babel preset keeps dynamic import(), while its runner is CJS. Evaluate the
// unchanged source through the repository's TypeScript/VM harness pattern and mock
// only the module boundary. Metro smoke separately verifies the real ESM package.
import { readFileSync } from 'fs';
import { join } from 'path';
import vm from 'vm';
import ts from 'typescript';
let startOwnerHomeSequence: typeof import('../ownerHomeSequence').startOwnerHomeSequence;

beforeEach(() => {
  jest.clearAllMocks();
  mockCallbacks.length = 0;
  const source = readFileSync(join(__dirname, '../ownerHomeSequence.ts'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exported: Record<string, unknown> = {};
  vm.runInNewContext(code, {
    exports: exported,
    require: (name: string) => {
      if (name !== 'gsap/gsap-core') throw new Error(`Unexpected dependency: ${name}`);
      return { gsap: { config: mockConfig, timeline: mockCreate } };
    },
  });
  startOwnerHomeSequence = exported.startOwnerHomeSequence as typeof startOwnerHomeSequence;
});
const settleImport = () => new Promise<void>((resolve) => setImmediate(resolve));

test('GSAP schedules only guarded callbacks; all visual frame work belongs to native callbacks', async () => {
  const reveal = jest.fn(),
    draw = jest.fn();
  let current = true;
  const stop = startOwnerHomeSequence({ reducedMotion: false, isCurrent: () => current, reveal, draw });
  await settleImport();
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockCallbacks).toHaveLength(2);
  mockCallbacks[0]();
  expect(reveal).toHaveBeenCalledTimes(1);
  current = false;
  mockCallbacks[1]();
  expect(draw).not.toHaveBeenCalled();
  stop();
  expect(mockKill).toHaveBeenCalledTimes(1);
  current = true;
  mockCallbacks.forEach((callback) => callback());
  expect(reveal).toHaveBeenCalledTimes(1);
});

test('reduced motion is immediate and creates no GSAP timeline', () => {
  const reveal = jest.fn(),
    draw = jest.fn();
  const stop = startOwnerHomeSequence({ reducedMotion: true, isCurrent: () => true, reveal, draw });
  expect(reveal).toHaveBeenCalledTimes(1);
  expect(draw).toHaveBeenCalledTimes(1);
  expect(mockCreate).not.toHaveBeenCalled();
  stop();
});

test('an invalidated scope before lazy import resolves creates no timeline', async () => {
  const stop = startOwnerHomeSequence({
    reducedMotion: false,
    isCurrent: () => true,
    reveal: jest.fn(),
    draw: jest.fn(),
  });
  stop();
  await settleImport();
  expect(mockCreate).not.toHaveBeenCalled();
});
