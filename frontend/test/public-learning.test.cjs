const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
const Router = require('react-router-dom');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
require.extensions['.ts'] = require.extensions['.tsx'] = () => {};
const src = path.resolve(__dirname, '../src');

function loadLearning({ realShell = false } = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const instance = new Module(filename, module);
    instance.filename = filename;
    instance.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, instance);
    instance.require = (name) => {
      if (name.endsWith('LearningShell') && !realShell)
        return {
          __esModule: true,
          default: ({ children }) => React.createElement('main', {}, children),
          LearningBreadcrumb: () => React.createElement('nav', { 'aria-label': 'Хлебные крошки' }),
        };
      if (realShell && /sections\/(Header|Footer|GlassTabBar)$/.test(name))
        return { __esModule: true, default: () => null };
      if (name.endsWith('.css')) return {};
      const resolved = Module._resolveFilename(name, instance);
      return resolved.startsWith(src) && /\.(tsx?|js)$/.test(resolved)
        ? load(resolved)
        : Module.createRequire(filename)(name);
    };
    const scrollBefore = process.env.AUTEXA_LEARNING_SCROLL_BEFORE;
    const scrollSource = scrollBefore && ['LearningShell.tsx', 'LearningLessonPage.tsx'].includes(path.basename(filename))
      ? path.join(scrollBefore, path.basename(filename)) : filename;
    instance._compile(
      ts.transpileModule(
        fs.readFileSync(
          process.env.AUTEXA_LEARNING_IMAGE_BEFORE &&
            filename === path.join(src, 'pages/landing/learning/LearningImage.tsx')
            ? process.env.AUTEXA_LEARNING_IMAGE_BEFORE
            : scrollSource,
          'utf8',
        ),
        {
          fileName: filename,
          compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
          },
        },
      ).outputText,
      filename,
    );
    return instance.exports;
  }
  const directory = path.join(src, 'pages/landing/learning');
  return {
    index: load(path.join(directory, 'LearningCenterPage.tsx')).default,
    lesson: load(path.join(directory, 'LearningLessonPage.tsx')).default,
    image: load(path.join(directory, 'LearningImage.tsx')).default,
    assets: load(path.join(directory, 'assets.ts')).learningAssets,
    captureIds: load(path.join(directory, 'assets.ts')).learningCaptureIds,
    ...load(path.join(directory, 'content.ts')),
    ...load(path.join(directory, 'progress.ts')),
    canRender: load(path.join(src, 'utils/sessionRestoreRoute.ts')).canRenderWithoutSessionProfile,
    publicSessionException: load(path.join(src, 'api/publicAuthPath.js')).isPublicSessionLandingPath,
  };
}

function browser(storage = new Map()) {
  global.window = {
    pageScrollCalls: [],
    scrollTo: (options) => window.pageScrollCalls.push(options),
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  global.document = { title: '', querySelector: () => null, body: { style: { overflow: '', backgroundColor: '' } } };
  return storage;
}
const allText = (node) => (typeof node === 'string' ? node : (node?.children ?? []).map(allText).join(' '));
async function mount(h, initial, previousEntries = []) {
  let navigate;
  let location;
  let tree;
  let focusCount = 0;
  const focusTargets = [];
  const focusCalls = [];
  const scrollCalls = [];
  let dialogOpen = false;
  function Probe() {
    navigate = Router.useNavigate();
    location = Router.useLocation();
    return null;
  }
  await Renderer.act(async () => {
    tree = Renderer.create(
      React.createElement(
        Router.MemoryRouter,
        { initialEntries: [...previousEntries, initial], future: { v7_startTransition: true, v7_relativeSplatPath: true } },
        React.createElement(Probe),
        React.createElement(
          Router.Routes,
          {},
          React.createElement(Router.Route, { path: '/obuchenie', element: React.createElement(h.index) }),
          React.createElement(Router.Route, { path: '/obuchenie/:lesson', element: React.createElement(h.lesson) }),
        ),
      ),
      {
        createNodeMock: (element) => ({
          focus: (options) => {
            focusCount++;
            focusTargets.push(element.props['aria-label'] ?? element.type);
            focusCalls.push({ element, options });
          },
          scrollIntoView: (options) => scrollCalls.push({ element, options }),
          showModal: () => {
            assert.equal(element.type, 'dialog');
            dialogOpen = true;
          },
          close: () => {
            dialogOpen = false;
          },
        }),
      },
    );
  });
  return {
    tree,
    get location() {
      return location;
    },
    get focusCount() {
      return focusCount;
    },
    get focusTargets() {
      return focusTargets;
    },
    focusCalls,
    scrollCalls,
    get dialogOpen() {
      return dialogOpen;
    },
    async go(to) {
      await Renderer.act(async () => navigate(to));
    },
    async click(label) {
      const control = tree.root.findAll(
        (item) =>
          ['a', 'button'].includes(item.type) &&
          allText(
            item.toJSON?.() ?? {
              children: item.children.map((child) =>
                typeof child === 'string' ? child : { children: child.children },
              ),
            },
          ).includes(label),
      )[0];
      assert.ok(control, `control ${label} exists`);
      const event = {
        button: 0,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
        currentTarget: { getAttribute: () => null },
      };
      await Renderer.act(async () => control.props.onClick(event));
    },
    destroy() {
      Renderer.act(() => tree.unmount());
    },
  };
}

const fixtureAsset = {
  src: '/learning/test-fixture.webp',
  width: 1206,
  height: 2622,
  alt: 'Учебный экран с тестовыми данными',
  hotspot: { x: 0.1, y: 0.2, width: 0.4, height: 0.06 },
  provenance: {
    sourceCommit: 'test',
    platform: 'ios',
    device: 'iPhone17Pro',
    capturedAt: 'test',
    screen: 'test',
    framing: 'full-frame',
    data: 'training-account',
  },
};

function losslessWebPDimensions(bytes) {
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.equal(bytes.readUInt32LE(4) + 8, bytes.length, 'WebP RIFF length is intact');
  let dimensions;
  let extended;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + size <= bytes.length, 'WebP chunk is intact');
    if (tag === 'VP8L') {
      assert.equal(bytes[start], 0x2f, 'image uses genuine lossless WebP encoding');
      const bits = bytes.readUInt32LE(start + 1);
      dimensions = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (tag === 'VP8X') extended = { width: bytes.readUIntLE(start + 4, 3) + 1, height: bytes.readUIntLE(start + 7, 3) + 1 };
    offset = start + size + (size % 2);
  }
  assert.ok(dimensions, 'lossless image pixels must be present');
  if (extended) assert.deepEqual(extended, dimensions);
  return dimensions;
}

function assertHotspot(target, context) {
  assert.ok(target, `${context} has a visible target`);
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Number.isFinite(target[key]), `${context}.${key} is finite`);
  assert.ok(target.x >= 0 && target.y >= 0 && target.width > 0 && target.height > 0, context);
  assert.ok(target.x + target.width <= 1 && target.y + target.height <= 1, `${context} stays inside the full frame`);
}

test('every tutorial step resolves a real lossless full-frame asset with content-hashed URL and bounded target', () => {
  const h = loadLearning();
  const publicDirectory = path.resolve(__dirname, '../public/learning');
  const expectedFiles = [];
  assert.deepEqual(Object.keys(h.assets).sort(), [...h.captureIds].sort(), 'typed captures and registry are complete');
  for (const [id, asset] of Object.entries(h.assets)) {
    assert.equal(path.posix.dirname(asset.src), '/learning');
    const filename = path.basename(asset.src);
    const bytes = fs.readFileSync(path.join(publicDirectory, filename));
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.equal(filename, `${id}-${hash.slice(0, 8)}.webp`, 'changed pixels must change the cached URL');
    assert.deepEqual(losslessWebPDimensions(bytes), { width: asset.width, height: asset.height }, id);
    assert.deepEqual({ width: asset.width, height: asset.height }, { width: 1206, height: 2622 }, 'exact requested device frame');
    assert.ok(asset.alt.trim().length > 0, `${id} has descriptive alt text`);
    assert.match(asset.provenance.sourceCommit, /^[0-9a-f]{40}$/);
    assert.ok(Number.isFinite(Date.parse(asset.provenance.capturedAt)), `${id} has a real capture timestamp`);
    assert.equal(asset.provenance.platform, 'ios');
    assert.equal(asset.provenance.device, 'iPhone17Pro');
    assert.equal(asset.provenance.framing, 'full-frame');
    assert.equal(asset.provenance.data, 'training-account');
    assert.deepEqual(Object.keys(asset.provenance).sort(), ['sourceCommit', 'platform', 'device', 'capturedAt', 'screen', 'framing', 'data'].sort(), 'private evidence paths and account details are not published');
    assertHotspot(asset.hotspot, id);
    expectedFiles.push(filename);
  }
  assert.deepEqual(fs.readdirSync(publicDirectory).sort(), expectedFiles.sort(), 'publish only the registered genuine captures');
  const referenced = new Set();
  for (const lesson of h.learningLessons) {
    assert.ok(lesson.steps.length > 0);
    for (const [index, step] of lesson.steps.entries()) {
      const asset = h.assets[step.asset];
      assert.ok(asset, `${lesson.slug} step ${index + 1} has its actual screenshot`);
      assertHotspot(step.hotspot ?? asset.hotspot, `${lesson.slug} step ${index + 1}`);
      referenced.add(step.asset);
    }
  }
  assert.deepEqual([...referenced].sort(), [...h.captureIds].sort(), 'all published captures serve a lesson step');
});

test('learning is render-only public; private paths, deeper routes and hard-logout exceptions remain closed', () => {
  const h = loadLearning();
  for (const route of ['/obuchenie', '/obuchenie/', '/obuchenie/dobavit-klienta', '/obuchenie/unknown']) {
    assert.equal(h.canRender(route), true, route);
    assert.equal(h.publicSessionException(route), false, route);
  }
  for (const route of ['/knowledge', '/obuchenie/a/b', '/obuchenie-extra'])
    assert.equal(h.canRender(route), false, route);
});

test('actual lesson URL navigation supports back/forward and safely normalizes malformed/out-of-range steps', async () => {
  browser();
  const h = loadLearning();
  const page = await mount(h, '/obuchenie/dobavit-klienta?step=2');
  try {
    assert.match(allText(page.tree.toJSON()), /Создайте нового клиента/);
    await page.click('Дальше');
    assert.equal(page.location.search, '?step=3');
    assert.match(allText(page.tree.toJSON()), /Заполните контакты/);
    await page.go(-1);
    assert.equal(page.location.search, '?step=2');
    await page.go(1);
    assert.equal(page.location.search, '?step=3');
    await page.go('/obuchenie/dobavit-klienta?step=9999');
    assert.equal(page.location.search, '?step=6');
    await page.go('/obuchenie/dobavit-klienta?step=-3');
    assert.equal(page.location.search, '?step=1');
    assert.ok(page.focusCount > 0, 'step changes move keyboard focus to instruction');
  } finally {
    page.destroy();
  }
});

test('Next reveals the visual stage while focus stays on the instruction; first mount and history preserve scroll', async () => {
  browser();
  const page = await mount(loadLearning(), '/obuchenie/dobavit-klienta?step=1');
  try {
    assert.equal(page.scrollCalls.length, 0, 'opening a lesson preserves initial page positioning');
    assert.equal(page.focusCalls.length, 0);
    await page.click('Дальше');
    assert.equal(page.location.search, '?step=2');
    assert.equal(page.scrollCalls.length, 1);
    assert.equal(
      page.scrollCalls[0].element.props.className,
      'learning-stage',
      'the screenshot stage must be revealed before the instruction beneath it on mobile',
    );
    assert.deepEqual(page.scrollCalls[0].options, { block: 'start', behavior: 'auto' });
    assert.equal(page.focusCalls.at(-1).element.props.id, 'learning-step-title');
    assert.deepEqual(page.focusCalls.at(-1).options, { preventScroll: true });
    const focusCount = page.focusCalls.length;
    await page.go(-1);
    assert.equal(page.location.search, '?step=1');
    await page.go(1);
    assert.equal(page.location.search, '?step=2');
    assert.equal(page.scrollCalls.length, 1, 'Back/Forward must leave native history scroll restoration alone');
    assert.equal(page.focusCalls.length, focusCount + 2, 'history changes still announce the new instruction');
    assert.ok(page.focusCalls.every(({ options }) => options.preventScroll === true));
  } finally {
    page.destroy();
  }
});

test('initial lesson URL normalization preserves scroll and focus for missing or noncanonical steps', async () => {
  for (const [suffix, canonical] of [['', '1'], ['?step=0002', '2'], ['?step=invalid', '1']]) {
    browser();
    const page = await mount(loadLearning({ realShell: true }), `/obuchenie/dobavit-klienta${suffix}`);
    try {
      assert.equal(page.location.search, `?step=${canonical}`);
      assert.deepEqual(
        { shellScrolls: window.pageScrollCalls.length, stageScrolls: page.scrollCalls.length, focusCalls: page.focusCalls.length },
        { shellScrolls: 0, stageScrolls: 0, focusCalls: 0 },
        `normalizing the same initial step must preserve scroll and focus ${suffix}`,
      );
    } finally {
      page.destroy();
    }
  }
});

test('POP to a noncanonical history step normalizes without forced scroll; actual PUSH keeps intended navigation', async () => {
  browser();
  const page = await mount(loadLearning({ realShell: true }), '/obuchenie/dobavit-klienta?step=3', [
    '/obuchenie/dobavit-klienta?step=0002',
  ]);
  try {
    assert.equal(window.pageScrollCalls.length, 0);
    assert.equal(page.scrollCalls.length, 0);
    await page.go(-1);
    assert.equal(page.location.search, '?step=2');
    assert.equal(window.pageScrollCalls.length, 0, 'shell leaves POP scroll restoration alone after canonical REPLACE');
    assert.equal(page.scrollCalls.length, 0, 'stage leaves POP scroll restoration alone after canonical REPLACE');
    assert.equal(page.focusCalls.length, 1, 'only the actual step change focuses its instruction');
    assert.deepEqual(page.focusCalls[0].options, { preventScroll: true });
    await page.click('Дальше');
    assert.equal(page.location.search, '?step=3');
    assert.equal(window.pageScrollCalls.length, 0, 'same-page step PUSH scrolls its stage rather than page top');
    assert.equal(page.scrollCalls.length, 1);
    assert.equal(page.scrollCalls[0].element.props.className, 'learning-stage');
    await page.go('/obuchenie');
    assert.equal(window.pageScrollCalls.length, 1, 'actual page PUSH scrolls the shell to top');
    assert.deepEqual(window.pageScrollCalls[0], { top: 0, behavior: 'instant' });
    await page.go(-1);
    assert.equal(window.pageScrollCalls.length, 1, 'POP to a different page preserves native restoration');
  } finally {
    page.destroy();
  }
});

test('unknown lessons have a recovery link; blocked storage never prevents reading, next or finish', async () => {
  browser();
  Object.defineProperty(window, 'localStorage', {
    get() {
      throw new Error('blocked storage');
    },
  });
  const h = loadLearning();
  const page = await mount(h, '/obuchenie/unknown?step=3');
  try {
    assert.match(allText(page.tree.toJSON()), /Урок не найден/);
    assert.ok(page.tree.root.findAllByType('a').some((item) => item.props.href === '/obuchenie'));
    await page.go('/obuchenie/dobavit-klienta?step=6');
    assert.match(allText(page.tree.toJSON()), /Найдите созданного клиента/);
    await page.click('Завершить');
    assert.equal(page.location.pathname, '/obuchenie');
    assert.match(allText(page.tree.toJSON()), /Чему научимся/);
  } finally {
    page.destroy();
  }
});

test('progress stores only allowed lesson IDs and steps, restores resume, and ignores corrupt values', async () => {
  const storage = browser();
  const h = loadLearning();
  storage.set(
    h.LEARNING_PROGRESS_KEY,
    JSON.stringify({
      lessons: { 'dobavit-klienta': { step: 999, complete: true }, injected: { step: 1, token: 'unsafe' } },
      lastLesson: 'injected',
    }),
  );
  assert.deepEqual(h.readLearningProgress(), {
    lessons: { 'dobavit-klienta': { step: 6, complete: true } },
    lastLesson: undefined,
  });
  h.saveLearningProgress('dobavit-uslugu', 2);
  const saved = JSON.parse(storage.get(h.LEARNING_PROGRESS_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['lastLesson', 'lessons']);
  assert.deepEqual(Object.keys(saved.lessons['dobavit-uslugu']).sort(), ['complete', 'step']);
  assert.equal(saved.lastLesson, 'dobavit-uslugu');
  const page = await mount(h, '/obuchenie');
  try {
    assert.ok(page.tree.root.findAllByType('a').some((item) => item.props.href === '/obuchenie/dobavit-uslugu?step=2'));
  } finally {
    page.destroy();
  }
  storage.set(h.LEARNING_PROGRESS_KEY, '{invalid');
  assert.deepEqual(h.readLearningProgress(), { lessons: {} });
});

test('completed first lesson offers the next unfinished lesson instead of the first-time introduction', async () => {
  const storage = browser();
  const h = loadLearning();
  const first = h.learningLessons[0];
  const next = h.learningLessons[1];
  storage.set(h.LEARNING_PROGRESS_KEY, JSON.stringify({
    lessons: { [first.slug]: { step: first.steps.length, complete: true } },
    lastLesson: first.slug,
  }));
  const page = await mount(h, '/obuchenie');
  try {
    const feature = page.tree.root.findByProps({ className: 'learning-feature-copy' });
    assert.doesNotMatch(allText(feature), /Первый раз в приложении/);
    assert.match(allText(feature), /Следующий урок/);
    assert.ok(allText(feature).includes(next.title));
    assert.equal(feature.findByType('a').props.href, h.lessonHref(next.slug));
    await page.click('Открыть следующий урок');
    assert.equal(page.location.pathname, `/obuchenie/${next.slug}`);
    assert.equal(page.location.search, '?step=1');
  } finally {
    page.destroy();
  }
});

test('all completed lessons show completion and a working repeat action without removing the catalog', async () => {
  const storage = browser();
  const h = loadLearning();
  storage.set(h.LEARNING_PROGRESS_KEY, JSON.stringify({
    lessons: Object.fromEntries(h.learningLessons.map((lesson) => [
      lesson.slug, { step: lesson.steps.length, complete: true },
    ])),
    lastLesson: h.learningLessons.at(-1).slug,
  }));
  const page = await mount(h, '/obuchenie');
  try {
    const feature = page.tree.root.findByProps({ className: 'learning-feature-copy' });
    assert.match(allText(feature), /Все уроки пройдены/);
    assert.doesNotMatch(allText(feature), /Первый раз в приложении/);
    assert.equal(feature.findByType('a').props.href, h.lessonHref(h.learningLessons[0].slug));
    assert.equal(page.tree.root.findAllByProps({ className: 'learning-lesson-row' }).filter((node) => node.type === 'a').length, h.learningLessons.length);
    await page.click('Повторить первый урок');
    assert.equal(page.location.pathname, `/obuchenie/${h.learningLessons[0].slug}`);
    assert.equal(page.location.search, '?step=1');
  } finally {
    page.destroy();
  }
});

test('unfinished last lesson resumes its saved step even when earlier lessons are incomplete', async () => {
  const storage = browser();
  const h = loadLearning();
  const lesson = h.learningLessons[2];
  storage.set(h.LEARNING_PROGRESS_KEY, JSON.stringify({
    lessons: { [lesson.slug]: { step: 3, complete: false } },
    lastLesson: lesson.slug,
  }));
  const page = await mount(h, '/obuchenie');
  try {
    const feature = page.tree.root.findByProps({ className: 'learning-feature-copy' });
    assert.match(allText(feature), /Продолжите с того же места/);
    assert.ok(allText(feature).includes(lesson.title));
    assert.equal(feature.findByType('a').props.href, h.lessonHref(lesson.slug, 3));
    await page.click('Продолжить · шаг 3');
    assert.equal(page.location.pathname, `/obuchenie/${lesson.slug}`);
    assert.equal(page.location.search, '?step=3');
  } finally {
    page.destroy();
  }
});

test('unavailable storage still offers a working fresh introduction', async () => {
  browser();
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked storage'); } });
  const h = loadLearning();
  const page = await mount(h, '/obuchenie');
  try {
    assert.match(allText(page.tree.root.findByProps({ className: 'learning-feature-copy' })), /Первый раз в приложении/);
    await page.click('Начать с первого урока');
    assert.equal(page.location.pathname, `/obuchenie/${h.learningLessons[0].slug}`);
    assert.equal(page.location.search, '?step=1');
  } finally {
    page.destroy();
  }
});

test('stale resumed progress uses the last valid step and its matching screenshot', async () => {
  const storage = browser();
  const h = loadLearning();
  const lesson = h.learningLessons[1];
  const lastStep = lesson.steps.length;
  const assetId = lesson.steps[lastStep - 1].asset;
  h.assets[assetId] = fixtureAsset;
  storage.set(h.LEARNING_PROGRESS_KEY, JSON.stringify({
    lessons: { [lesson.slug]: { step: 9999, complete: false } },
    lastLesson: lesson.slug,
  }));
  const page = await mount(h, '/obuchenie');
  try {
    const feature = page.tree.root.findByProps({ className: 'learning-feature-copy' });
    assert.equal(feature.findByType('a').props.href, h.lessonHref(lesson.slug, lastStep));
    assert.match(allText(feature), new RegExp(`Продолжить · шаг ${lastStep}`));
    const row = page.tree.root.findAllByType('a').find((node) =>
      node.props.className === 'learning-lesson-row' && allText(node).includes(lesson.title),
    );
    assert.ok(row, 'resumed lesson is present in the free-choice catalog');
    assert.equal(row.props.href, h.lessonHref(lesson.slug, lastStep));
    assert.match(allText(row), new RegExp(`Шаг ${lastStep}`));
    assert.doesNotMatch(allText(row), /9999/);
    const preview = page.tree.root.findByProps({ className: 'learning-feature-screen' });
    assert.equal(preview.findByType('img').props.src, fixtureAsset.src);
    await page.click(`Продолжить · шаг ${lastStep}`);
    assert.equal(page.location.search, `?step=${lastStep}`);
    assert.ok(allText(page.tree.toJSON()).includes(lesson.steps[lastStep - 1].title));
  } finally {
    page.destroy();
  }
});

test('search finds actions and handles ё/е; topic and query live in URL and empty results recover', async () => {
  browser();
  const h = loadLearning();
  assert.ok(h.searchLessons('расчет').length === 0);
  assert.ok(h.searchLessons('Ещё').length > 0);
  const page = await mount(h, '/obuchenie?q=клиент&topic=Клиенты');
  try {
    assert.equal(
      page.tree.root.findAll((item) => item.type === 'a' && item.props.className === 'learning-lesson-row').length,
      1,
    );
    await page.go('/obuchenie?q=продажа');
    const sales = page.tree.root.findAll((item) => item.type === 'a' && item.props.className === 'learning-lesson-row');
    assert.equal(sales.length, 1);
    assert.equal(sales[0].props.href, '/obuchenie/sozdat-chek?step=1');
    await page.go('/obuchenie?q=несуществующий');
    assert.match(allText(page.tree.toJSON()), /Такого урока пока нет/);
    await page.click('Показать все уроки');
    assert.equal(page.location.search, '');
    assert.equal(
      page.tree.root.findAll((item) => item.type === 'a' && item.props.className === 'learning-lesson-row').length,
      h.learningLessons.length,
    );
  } finally {
    page.destroy();
  }
});

test('reused client-search screenshot highlights add first and people after saving', async () => {
  browser();
  const h = loadLearning();
  h.assets['clients-list'] = { ...fixtureAsset, hotspot: { x: 0.88, y: 0.08, width: 0.09, height: 0.045 } };
  const page = await mount(h, '/obuchenie/dobavit-klienta?step=2');
  try {
    const target = () => page.tree.root.findByProps({ className: 'learning-image-button' })
      .findByProps({ className: 'learning-hotspot' }).props.style;
    assert.equal(target().left, '88%');
    assert.match(allText(page.tree.toJSON()), /синий «\+»/);
    await page.go('/obuchenie/dobavit-klienta?step=5');
    assert.equal(target().left, '77%', 'the same screenshot must switch from add to the people control');
    assert.match(allText(page.tree.toJSON()), /значок двух людей/);
    assert.equal(page.tree.root.findByProps({ className: 'learning-image-button' }).findByType('img').props.src, fixtureAsset.src);
  } finally {
    page.destroy();
  }
});

test('image loading failure is recoverable; native dialog Escape restores focus and scroll lock', async () => {
  browser();
  const h = loadLearning();
  h.assets['home-navigation'] = fixtureAsset;
  const page = await mount(h, '/obuchenie/pervye-shagi?step=1');
  try {
    const image = page.tree.root.findAllByType('img')[0];
    assert.equal(image.props.width, 1206);
    assert.equal(image.props.height, 2622);
    await Renderer.act(async () => image.props.onError());
    assert.match(allText(page.tree.toJSON()), /Скриншот не загрузился/);
    await page.click('Повторить');
    const trigger = page.tree.root.findByProps({ className: 'learning-image-button' });
    assert.equal(trigger.type, 'button', 'native Enter/Space semantics');
    await Renderer.act(async () => trigger.props.onClick());
    assert.equal(page.dialogOpen, true);
    assert.equal(document.body.style.overflow, 'hidden');
    const before = page.focusCount;
    await Renderer.act(async () => page.tree.root.findByType('dialog').props.onCancel({ preventDefault() {} }));
    assert.equal(page.dialogOpen, false);
    assert.equal(document.body.style.overflow, '');
    assert.ok(page.focusCount > before);
  } finally {
    page.destroy();
  }
});

test('stage image failure while expanded releases scroll, focuses retry, and opens a fresh dialog after retry', async () => {
  browser();
  const h = loadLearning();
  h.assets['home-navigation'] = fixtureAsset;
  const page = await mount(h, '/obuchenie/pervye-shagi?step=1');
  try {
    document.body.style.overflow = 'auto';
    await Renderer.act(async () => page.tree.root.findByProps({ className: 'learning-image-button' }).props.onClick());
    assert.equal(page.dialogOpen, true);
    assert.equal(document.body.style.overflow, 'hidden');
    const stageImage = page.tree.root.findByProps({ className: 'learning-image-button' }).findByType('img');
    await Renderer.act(async () => stageImage.props.onError());
    assert.match(allText(page.tree.toJSON()), /Скриншот не загрузился/);
    assert.equal(page.tree.root.findAllByType('dialog').length, 0);
    assert.equal(document.body.style.overflow, 'auto', 'image failure must release the modal scroll lock');
    assert.equal(page.dialogOpen, false);
    assert.equal(
      page.focusTargets.at(-1),
      'Повторить загрузку скриншота',
      'focus moves to the mounted recovery action',
    );
    await page.click('Повторить');
    await Renderer.act(async () => page.tree.root.findByProps({ className: 'learning-image-button' }).props.onClick());
    assert.equal(page.dialogOpen, true, 'retry opens a fresh native modal');
    assert.equal(document.body.style.overflow, 'hidden');
    await Renderer.act(async () => page.tree.root.findByType('dialog').props.onCancel({ preventDefault() {} }));
    assert.equal(document.body.style.overflow, 'auto');
    assert.match(page.focusTargets.at(-1), /^Увеличить скриншот:/);
  } finally {
    page.destroy();
  }
});
