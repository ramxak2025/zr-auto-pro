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
    const scrollSource =
      scrollBefore && ['LearningShell.tsx', 'LearningLessonPage.tsx'].includes(path.basename(filename))
        ? path.join(scrollBefore, path.basename(filename))
        : filename;
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
    desktopAssets: load(path.join(directory, 'desktop-assets.ts')).desktopLearningAssets,
    ...load(path.join(directory, 'search.ts')),
    ...load(path.join(directory, 'annotation.ts')),
    ...load(path.join(directory, 'content.ts')),
    ...load(path.join(directory, 'progress.ts')),
    canRender: load(path.join(src, 'utils/sessionRestoreRoute.ts')).canRenderWithoutSessionProfile,
    publicSessionException: load(path.join(src, 'api/publicAuthPath.js')).isPublicSessionLandingPath,
  };
}

const layoutFrames = new Map();
let nextLayoutFrame = 0;
function browser(storage = new Map()) {
  layoutFrames.clear();
  global.requestAnimationFrame = (callback) => {
    const id = ++nextLayoutFrame;
    layoutFrames.set(id, callback);
    return id;
  };
  global.cancelAnimationFrame = (id) => layoutFrames.delete(id);
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
async function mount(
  h,
  initial,
  previousEntries = [],
  { imageReady = true, viewportWidth = 800, viewportHeight = 600 } = {},
) {
  let navigate;
  let location;
  let tree;
  let focusCount = 0;
  const focusTargets = [];
  const focusCalls = [];
  const scrollCalls = [];
  const viewportScrollCalls = [];
  const mockedNodes = [];
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
        {
          initialEntries: [...previousEntries, initial],
          future: { v7_startTransition: true, v7_relativeSplatPath: true },
        },
        React.createElement(Probe),
        React.createElement(
          Router.Routes,
          {},
          React.createElement(Router.Route, { path: '/obuchenie', element: React.createElement(h.index) }),
          React.createElement(Router.Route, { path: '/obuchenie/:lesson', element: React.createElement(h.lesson) }),
        ),
      ),
      {
        createNodeMock: (element) => {
          const events = new Map();
          const node = {
            element,
            events,
            complete: imageReady,
            naturalWidth: imageReady ? (element.props.width ?? 0) : 0,
            clientWidth: element.type === 'img' ? element.props.width : viewportWidth,
            clientHeight: element.type === 'img' ? element.props.height : viewportHeight,
            getBoundingClientRect: () => ({
              width: element.props.width ?? viewportWidth,
              height: element.props.height ?? viewportHeight,
            }),
            addEventListener: (name, handler) => {
              if (!events.has(name)) events.set(name, new Set());
              events.get(name).add(handler);
            },
            removeEventListener: (name, handler) => events.get(name)?.delete(handler),
            scrollTo: (options) => viewportScrollCalls.push({ element, options }),
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
          };
          mockedNodes.push(node);
          return node;
        },
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
    viewportScrollCalls,
    mockedNodes,
    async flushLayout() {
      await Renderer.act(async () => {
        const callbacks = [...layoutFrames.values()];
        layoutFrames.clear();
        callbacks.forEach((callback) => callback());
      });
    },
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
  for (let offset = 12; offset + 8 <= bytes.length; ) {
    const tag = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert.ok(start + size <= bytes.length, 'WebP chunk is intact');
    if (tag === 'VP8L') {
      assert.equal(bytes[start], 0x2f, 'image uses genuine lossless WebP encoding');
      const bits = bytes.readUInt32LE(start + 1);
      dimensions = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (tag === 'VP8X')
      extended = { width: bytes.readUIntLE(start + 4, 3) + 1, height: bytes.readUIntLE(start + 7, 3) + 1 };
    offset = start + size + (size % 2);
  }
  assert.ok(dimensions, 'lossless image pixels must be present');
  if (extended) assert.deepEqual(extended, dimensions);
  return dimensions;
}

function assertHotspot(target, context) {
  assert.ok(target, `${context} has a visible target`);
  for (const key of ['x', 'y', 'width', 'height'])
    assert.ok(Number.isFinite(target[key]), `${context}.${key} is finite`);
  assert.ok(target.x >= 0 && target.y >= 0 && target.width > 0 && target.height > 0, context);
  assert.ok(target.x + target.width <= 1 && target.y + target.height <= 1, `${context} stays inside the full frame`);
}

test('every mobile tutorial step keeps exact native lossless full-frame assets and bounded targets', () => {
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
    assert.deepEqual(
      { width: asset.width, height: asset.height },
      { width: 1206, height: 2622 },
      'exact requested device frame',
    );
    assert.ok(asset.alt.trim().length > 0, `${id} has descriptive alt text`);
    assert.match(asset.provenance.sourceCommit, /^[0-9a-f]{40}$/);
    assert.ok(Number.isFinite(Date.parse(asset.provenance.capturedAt)), `${id} has a real capture timestamp`);
    assert.equal(asset.provenance.platform, 'ios');
    assert.equal(asset.provenance.device, 'iPhone17Pro');
    assert.equal(asset.provenance.framing, 'full-frame');
    assert.equal(asset.provenance.data, 'training-account');
    assert.deepEqual(
      Object.keys(asset.provenance).sort(),
      ['sourceCommit', 'platform', 'device', 'capturedAt', 'screen', 'framing', 'data'].sort(),
      'private evidence paths and account details are not published',
    );
    assertHotspot(asset.hotspot, id);
    expectedFiles.push(filename);
  }
  assert.deepEqual(
    fs
      .readdirSync(publicDirectory)
      .filter((filename) => !filename.startsWith('desktop-'))
      .sort(),
    expectedFiles.sort(),
    'publish only the registered genuine captures',
  );
  const referenced = new Set();
  for (const lesson of h.learningLessons.filter((item) => item.platform === 'mobile')) {
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

function assertDesktopAsset(id, asset) {
  assert.match(id, /^desktop-[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(path.posix.dirname(asset.src), '/learning');
  const filename = path.basename(asset.src);
  const bytes = fs.readFileSync(path.resolve(__dirname, '../public/learning', filename));
  const sha = createHash('sha256').update(bytes).digest('hex');
  assert.equal(asset.provenance.sha256, sha, `${id} full WebP SHA`);
  assert.equal(filename, `${id}-${sha.slice(0, 8)}.webp`);
  const actual = losslessWebPDimensions(bytes);
  assert.deepEqual(
    actual,
    { width: asset.width, height: asset.height },
    'actual variable-size WebP pixels match metadata',
  );
  assert.deepEqual(actual, asset.provenance.viewport, 'capture pixel viewport matches actual image header');
  assert.ok(Number.isInteger(asset.width) && asset.width > 0 && Number.isInteger(asset.height) && asset.height > 0);
  assert.equal(asset.provenance.platform, 'desktop');
  assert.equal(asset.provenance.browser, 'Chrome');
  assert.equal(asset.provenance.framing, 'content-viewport');
  assert.equal(asset.provenance.data, 'training-account');
  assert.match(asset.provenance.sourceCommit, /^[a-f0-9]{40}$/);
  assert.match(asset.provenance.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(asset.provenance.capturedAt)));
  assert.ok(asset.alt.trim() && asset.provenance.screen.trim());
  assert.deepEqual(
    Object.keys(asset.provenance).sort(),
    ['sourceCommit', 'browser', 'platform', 'framing', 'data', 'capturedAt', 'screen', 'sha256', 'viewport'].sort(),
  );
  assert.deepEqual(
    Object.keys(asset).sort(),
    ['src', 'width', 'height', 'alt', 'provenance', ...(asset.hotspot ? ['hotspot'] : [])].sort(),
    'publish only asset metadata, never private pipeline proof',
  );
  assert.doesNotMatch(JSON.stringify(asset), /\/Users\/|private-oct|capture\/shots|Bearer |password|tenantId|userId/i);
  assert.doesNotMatch(asset.alt + ' ' + asset.provenance.screen, /Root viewed|\b(?:privacy|approved|raw|proof)\b/i);
  if (asset.hotspot) assertHotspot(asset.hotspot, id);
}

test('desktop assets separately validate real variable dimensions, full hashes and public-only provenance', () => {
  const h = loadLearning();
  const assets = Object.entries(h.desktopAssets);
  assert.ok(assets.length > 0, 'first real desktop guide requires actual captures');
  for (const [id, asset] of assets) assertDesktopAsset(id, asset);
  const [id, asset] = assets[0];
  assert.throws(
    () => assertDesktopAsset(id, { ...asset, provenance: { ...asset.provenance, sha256: '0'.repeat(64) } }),
    /full WebP SHA/,
  );
  assert.throws(
    () =>
      assertDesktopAsset(id, {
        ...asset,
        provenance: { ...asset.provenance, viewport: { width: asset.width + 1, height: asset.height } },
      }),
    /viewport/,
  );
  assert.throws(() =>
    assertDesktopAsset(id, { ...asset, provenance: { ...asset.provenance, rawPath: '/Users/private/source.png' } }),
  );
});

test('catalog IDs, platform links and effective rich targets cover every registered guide without claiming all features', () => {
  const h = loadLearning();
  const slugs = h.learningLessons.map((lesson) => lesson.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  const assets = { ...h.assets, ...h.desktopAssets };
  assert.equal(
    Object.keys(assets).length,
    Object.keys(h.assets).length + Object.keys(h.desktopAssets).length,
    'asset namespaces never collide',
  );
  const used = new Set();
  for (const lesson of h.learningLessons) {
    assert.match(lesson.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const desktop = lesson.platform === 'desktop';
    assert.equal(lesson.slug.startsWith('desktop-'), desktop);
    assert.ok(['work', 'clients', 'stock', 'money', 'company'].includes(lesson.topic));
    assert.ok(lesson.steps.length > 0);
    assert.equal(h.canRender(new URL(h.lessonHref(lesson.slug), 'https://example.test').pathname), true);
    if (desktop) {
      assert.ok(lesson.featureIds.length > 0);
      assert.equal(new Set(lesson.featureIds).size, lesson.featureIds.length);
      for (const id of lesson.featureIds) assert.match(id, /^[a-z][a-z_]*$/);
      for (const task of lesson.searchTasks ?? []) {
        assert.ok(Number.isInteger(task.step) && task.step >= 1 && task.step <= lesson.steps.length);
        assert.ok(
          task.aliases.length > 0 &&
            task.aliases.every((alias) => alias.trim() && alias.length <= h.MAX_LEARNING_QUERY_LENGTH),
        );
      }
    }
    for (const [index, step] of lesson.steps.entries()) {
      assert.equal(
        step.asset.startsWith('desktop-'),
        desktop,
        `${lesson.slug} step ${index + 1} never cross-links to the other platform's image`,
      );
      const asset = assets[step.asset];
      assert.ok(asset, `${lesson.slug} step ${index + 1} has a registered capture`);
      assert.equal(asset.provenance.platform, desktop ? 'desktop' : 'ios');
      assertHotspot(step.hotspot ?? asset.hotspot, `${lesson.slug} step ${index + 1}`);
      if (desktop) {
        assert.ok(
          ['click', 'focus'].includes(step.annotation?.kind),
          'every desktop step has a rich click/focus marker',
        );
        if (step.annotation.label) assert.ok(step.annotation.label.length <= 48, 'callout label stays short');
      }
      used.add(step.asset);
    }
  }
  assert.deepEqual([...used].sort(), Object.keys(assets).sort(), 'all published images support actual lesson steps');
  assert.deepEqual(
    fs.readdirSync(path.resolve(__dirname, '../public/learning')).sort(),
    Object.values(assets)
      .map((asset) => path.basename(asset.src))
      .sort(),
    'no public raw images, unregistered files or diagnostic artifacts',
  );
});

test('browser-local progress round-trips every actual guide and keeps mobile completion', () => {
  browser();
  const h = loadLearning();
  for (const lesson of h.learningLessons) h.saveLearningProgress(lesson.slug, lesson.steps.length, true);
  const saved = h.readLearningProgress();
  assert.equal(Object.keys(saved.lessons).length, h.learningLessons.length);
  for (const lesson of h.learningLessons)
    assert.deepEqual(saved.lessons[lesson.slug], { step: lesson.steps.length, complete: true });
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
  for (const [suffix, canonical] of [
    ['', '1'],
    ['?step=0002', '2'],
    ['?step=invalid', '1'],
  ]) {
    browser();
    const page = await mount(loadLearning({ realShell: true }), `/obuchenie/dobavit-klienta${suffix}`);
    try {
      assert.equal(page.location.search, `?step=${canonical}`);
      assert.deepEqual(
        {
          shellScrolls: window.pageScrollCalls.length,
          stageScrolls: page.scrollCalls.length,
          focusCalls: page.focusCalls.length,
        },
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
  storage.set(
    h.LEARNING_PROGRESS_KEY,
    JSON.stringify({
      lessons: { [first.slug]: { step: first.steps.length, complete: true } },
      lastLesson: first.slug,
    }),
  );
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
  storage.set(
    h.LEARNING_PROGRESS_KEY,
    JSON.stringify({
      lessons: Object.fromEntries(
        h.learningLessons.map((lesson) => [lesson.slug, { step: lesson.steps.length, complete: true }]),
      ),
      lastLesson: h.learningLessons.at(-1).slug,
    }),
  );
  const page = await mount(h, '/obuchenie');
  try {
    const feature = page.tree.root.findByProps({ className: 'learning-feature-copy' });
    assert.match(allText(feature), /Все уроки пройдены/);
    assert.doesNotMatch(allText(feature), /Первый раз в приложении/);
    assert.equal(feature.findByType('a').props.href, h.lessonHref(h.learningLessons[0].slug));
    assert.equal(
      page.tree.root.findAllByProps({ className: 'learning-lesson-row' }).filter((node) => node.type === 'a').length,
      h.learningLessons.length,
    );
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
  storage.set(
    h.LEARNING_PROGRESS_KEY,
    JSON.stringify({
      lessons: { [lesson.slug]: { step: 3, complete: false } },
      lastLesson: lesson.slug,
    }),
  );
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
  Object.defineProperty(window, 'localStorage', {
    get() {
      throw new Error('blocked storage');
    },
  });
  const h = loadLearning();
  const page = await mount(h, '/obuchenie');
  try {
    assert.match(
      allText(page.tree.root.findByProps({ className: 'learning-feature-copy' })),
      /Первый раз в приложении/,
    );
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
  storage.set(
    h.LEARNING_PROGRESS_KEY,
    JSON.stringify({
      lessons: { [lesson.slug]: { step: 9999, complete: false } },
      lastLesson: lesson.slug,
    }),
  );
  const page = await mount(h, '/obuchenie');
  try {
    const feature = page.tree.root.findByProps({ className: 'learning-feature-copy' });
    assert.equal(feature.findByType('a').props.href, h.lessonHref(lesson.slug, lastStep));
    assert.match(allText(feature), new RegExp(`Продолжить · шаг ${lastStep}`));
    const row = page.tree.root
      .findAllByType('a')
      .find((node) => node.props.className === 'learning-lesson-row' && allText(node).includes(lesson.title));
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
  assert.deepEqual(h.searchLessons('расчет'), h.searchLessons('расчёт'));
  assert.ok(h.searchLessons('Ещё').length > 0);
  const page = await mount(h, '/obuchenie?platform=mobile&q=клиент&topic=Клиенты');
  try {
    assert.equal(
      page.tree.root.findAll((item) => item.type === 'a' && item.props.className === 'learning-lesson-row').length,
      1,
    );
    await page.go('/obuchenie?platform=mobile&q=продажа');
    const sales = page.tree.root.findAll((item) => item.type === 'a' && item.props.className === 'learning-lesson-row');
    assert.ok(sales.length >= 1);
    assert.equal(new URL(sales[0].props.href, 'https://example.test').pathname, '/obuchenie/sozdat-chek');
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
    const target = () =>
      page.tree.root.findByProps({ className: 'learning-image-button' }).findByProps({ className: 'learning-hotspot' })
        .props.style;
    assert.equal(target().left, '88%');
    assert.match(allText(page.tree.toJSON()), /синий «\+»/);
    await page.go('/obuchenie/dobavit-klienta?step=5');
    assert.equal(target().left, '77%', 'the same screenshot must switch from add to the people control');
    assert.match(allText(page.tree.toJSON()), /значок двух людей/);
    assert.equal(
      page.tree.root.findByProps({ className: 'learning-image-button' }).findByType('img').props.src,
      fixtureAsset.src,
    );
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

// Test-only desktop data exercises the framework before any public desktop captures are registered.
function addDesktopFixture(h) {
  const lesson = {
    slug: 'desktop-test-priemka',
    platform: 'desktop',
    topic: 'stock',
    category: 'Поставщики',
    title: 'Принять поставку',
    description: 'Учебный тест поиска, не публичный урок.',
    steps: [
      {
        title: 'Откройте заказ',
        action: 'Найдите заказ поставщику.',
        result: 'Форма открыта.',
        asset: 'desktop-test-capture',
      },
      {
        title: 'Укажите количество',
        action: 'Введите принятое количество товара.',
        result: 'Количество указано.',
        asset: 'desktop-test-capture',
        hotspot: { x: 0.88, y: 0.86, width: 0.1, height: 0.08 },
        annotation: { kind: 'click', label: 'Количество' },
      },
      {
        title: 'Проверьте результат',
        action: 'Сверьте сохранённые данные.',
        result: 'Данные сверены.',
        asset: 'desktop-test-capture',
      },
    ],
  };
  h.learningLessons.push(lesson);
  h.desktopAssets['desktop-test-capture'] = {
    ...fixtureAsset,
    width: 1940,
    height: 1280,
    src: '/learning/desktop-test-only.webp',
    provenance: {
      platform: 'desktop',
      browser: 'Chrome',
      framing: 'content-viewport',
      data: 'training-account',
      sourceCommit: 'a'.repeat(40),
      capturedAt: '2026-10-23T00:00:00Z',
      screen: 'test-only',
      sha256: 'b'.repeat(64),
      viewport: { width: 1940, height: 1280 },
    },
  };
  return lesson;
}

test('ranked search normalizes Russian, bounded typos and synonyms, requires every word, and chooses the matching step', () => {
  const h = loadLearning();
  const desktop = addDesktopFixture(h);
  const synonym = h.rankLearningLessons([desktop], 'как оприходовать поставку', { platform: 'desktop' });
  assert.equal(synonym[0].lesson.slug, desktop.slug);
  const typo = h.rankLearningLessons([desktop], 'принятое количетсво', { topic: 'stock' });
  assert.equal(typo[0].step, 2);
  assert.equal(typo[0].lesson.slug, desktop.slug);
  assert.deepEqual(h.rankLearningLessons(h.learningLessons, 'принятое несуществующее'), []);
  assert.deepEqual(
    h.rankLearningLessons(h.learningLessons, 'приёмка'),
    h.rankLearningLessons(h.learningLessons, 'приемка'),
  );
  assert.doesNotThrow(() => h.rankLearningLessons(h.learningLessons, '[.*(+?'.repeat(20000)));
  const oversizedLink = new URL(
    h.lessonHref(desktop.slug, 2, new URLSearchParams({ q: 'я'.repeat(10000) })),
    'https://example.test',
  );
  assert.equal(
    oversizedLink.searchParams.get('q').length,
    h.MAX_LEARNING_QUERY_LENGTH,
    'generated navigation URLs stay bounded too',
  );
  const once = h.rankLearningLessons(h.learningLessons, 'принятое количество');
  assert.deepEqual(h.rankLearningLessons(h.learningLessons, 'принятое количество'), once, 'stable relevance order');
  const bodyOnly = {
    ...desktop,
    slug: 'desktop-test-body',
    title: 'Обзор',
    steps: [{ ...desktop.steps[0], result: 'Введите принятое количество товара.' }],
  };
  assert.equal(
    h.rankLearningLessons([bodyOnly, desktop], 'принятое количество')[0].lesson.slug,
    desktop.slug,
    'action evidence outranks result/body evidence',
  );
});

test('desktop search filters survive direct best-step navigation, Next and Back even at phone width', async () => {
  browser();
  window.innerWidth = 360;
  const h = loadLearning();
  const desktop = addDesktopFixture(h);
  const page = await mount(h, '/obuchenie?platform=desktop&group=stock&q=принятое%20количество');
  try {
    const rows = page.tree.root.findAllByType('a').filter((node) => node.props.className === 'learning-lesson-row');
    const row = rows.find(
      (node) => new URL(node.props.href, 'https://example.test').pathname === `/obuchenie/${desktop.slug}`,
    );
    assert.ok(row, 'matching fixture remains reachable among real catalog results');
    const target = new URL(row.props.href, 'https://example.test');
    assert.equal(target.searchParams.get('step'), '2');
    assert.match(allText(row), /Компьютер/);
    assert.match(allText(row), /Шаг\s+2\s*:\s+Укажите количество/);
    await page.go(row.props.href);
    assert.equal(page.location.pathname, `/obuchenie/${desktop.slug}`);
    assert.equal(page.location.search.includes('platform=desktop'), true);
    assert.ok(page.tree.root.findByProps({ className: 'learning-workspace is-desktop' }));
    await page.click('Дальше');
    assert.equal(new URLSearchParams(page.location.search).get('step'), '3');
    assert.equal(new URLSearchParams(page.location.search).get('group'), 'stock');
    assert.equal(new URLSearchParams(page.location.search).get('q'), 'принятое количество');
    await page.go(-1);
    assert.equal(new URLSearchParams(page.location.search).get('step'), '2');
    assert.ok(allText(page.tree.toJSON()).includes(desktop.title));
  } finally {
    page.destroy();
  }
});

test('platform controls are explicit, default to all, and old topic links keep working', async () => {
  browser();
  const h = loadLearning();
  addDesktopFixture(h);
  const page = await mount(h, '/obuchenie');
  try {
    assert.equal(
      page.tree.root.findAllByType('a').filter((node) => node.props.className === 'learning-lesson-row').length,
      h.learningLessons.length,
    );
    const platforms = page.tree.root.findByProps({ 'aria-label': 'Платформа обучения' });
    assert.equal(
      platforms.findAllByType('button').find((button) => allText(button) === 'Все').props['aria-pressed'],
      true,
    );
    await Renderer.act(async () =>
      platforms
        .findAllByType('button')
        .find((button) => allText(button) === 'Компьютер')
        .props.onClick(),
    );
    assert.equal(new URLSearchParams(page.location.search).get('platform'), 'desktop');
    assert.equal(
      page.tree.root.findAllByType('a').filter((node) => node.props.className === 'learning-lesson-row').length,
      h.learningLessons.filter((lesson) => lesson.platform === 'desktop').length,
    );
    await page.go('/obuchenie?topic=Клиенты');
    assert.equal(
      page.tree.root.findAllByType('a').filter((node) => node.props.className === 'learning-lesson-row').length,
      h.learningLessons.filter((lesson) => lesson.topic === 'clients').length,
    );
    await page.go('/obuchenie?topic=Касса');
    assert.equal(
      page.tree.root.findAllByType('a').filter((node) => node.props.className === 'learning-lesson-row').length,
      h.learningLessons.filter((lesson) => lesson.category === 'Касса').length,
    );
  } finally {
    page.destroy();
  }
});

test('desktop progress extends the same store without changing mobile completion or slugs and order', () => {
  const storage = browser();
  const h = loadLearning();
  assert.equal(h.LEARNING_PROGRESS_KEY, 'autexa.public-learning.v1');
  assert.deepEqual(
    h.learningLessons
      .filter((lesson) => lesson.platform === 'mobile')
      .map((lesson) => [lesson.slug, lesson.steps.length]),
    [
      ['pervye-shagi', 3],
      ['dobavit-klienta', 6],
      ['dobavit-uslugu', 5],
      ['sozdat-chek', 11],
      ['nayti-chek', 3],
    ],
  );
  h.saveLearningProgress('dobavit-klienta', 6, true);
  const desktop = addDesktopFixture(h);
  h.saveLearningProgress(desktop.slug, 2);
  const saved = JSON.parse(storage.get(h.LEARNING_PROGRESS_KEY));
  assert.deepEqual(saved.lessons['dobavit-klienta'], { step: 6, complete: true });
  assert.deepEqual(saved.lessons[desktop.slug], { step: 2, complete: false });
});

test('annotation geometry stays finite, pins and labels clamp at image edges, and labels sit outside target', () => {
  const h = loadLearning();
  for (const target of [
    { x: 0, y: 0, width: 0.1, height: 0.05 },
    { x: 0.9, y: 0.92, width: 0.1, height: 0.08 },
    { x: 0.3, y: 0.4, width: 0.2, height: 0.1 },
  ]) {
    const geometry = h.learningAnnotationGeometry(target);
    assert.ok(geometry.pin.x > 0 && geometry.pin.x < 1 && geometry.pin.y > 0 && geometry.pin.y < 1);
    assert.ok(geometry.label.x >= 0.22 && geometry.label.x <= 0.78);
    assert.ok(geometry.label.y < target.y || geometry.label.y > target.y + target.height);
  }
  assert.equal(h.learningAnnotationGeometry({ x: Number.NaN, y: 0, width: 0.1, height: 0.1 }), null);
  assert.equal(h.learningAnnotationGeometry({ x: 0.99, y: 0, width: 0.1, height: 0.1 }), null);
  const narrowTarget = { x: 0, y: 0.08, width: 0.1, height: 0.05 };
  const narrow = h.learningAnnotationGeometry(narrowTarget, 'above', { width: 320, height: 210 });
  assert.equal(
    narrow.label.side,
    'below',
    'small landscape frame has insufficient room above for the real label height',
  );
  assert.ok(narrow.label.y * 210 + 28 <= 210, 'label fits the actual rendered height');
  assert.ok(narrow.pin.x * 320 >= 14, 'pin remains inside the rendered frame at its left edge');
});

test('resumed featured preview, inline image and zoom use the same per-step target and annotation', async () => {
  const storage = browser();
  const h = loadLearning();
  h.learningLessons[1].steps[4].annotation = { kind: 'click', label: 'Список клиентов' };
  storage.set(
    h.LEARNING_PROGRESS_KEY,
    JSON.stringify({ lessons: { 'dobavit-klienta': { step: 5, complete: false } }, lastLesson: 'dobavit-klienta' }),
  );
  const page = await mount(h, '/obuchenie');
  try {
    const preview = page.tree.root.findByProps({ className: 'learning-feature-screen' });
    assert.equal(preview.findByProps({ className: 'learning-hotspot' }).props.style.left, '77%');
    assert.equal(allText(preview.findByProps({ className: 'learning-target-label is-above' })), 'Список клиентов');
    await page.click('Продолжить · шаг 5');
    const stage = page.tree.root.findByProps({ className: 'learning-image-button' });
    assert.equal(stage.findByProps({ className: 'learning-hotspot' }).props.style.left, '77%');
    await Renderer.act(async () => stage.props.onClick());
    const dialog = page.tree.root.findByType('dialog');
    assert.equal(dialog.findByProps({ className: 'learning-hotspot' }).props.style.left, '77%');
    assert.equal(allText(dialog.findByProps({ className: 'learning-target-label is-above' })), 'Список клиентов');
  } finally {
    page.destroy();
  }
});

test('desktop natural-size zoom opens centered on the step target and closes with normal focus restoration', async () => {
  browser();
  const h = loadLearning();
  addDesktopFixture(h);
  const page = await mount(h, '/obuchenie/desktop-test-priemka?platform=desktop&step=2');
  try {
    await Renderer.act(async () => page.tree.root.findByProps({ className: 'learning-image-button' }).props.onClick());
    assert.equal(page.dialogOpen, true);
    assert.equal(page.tree.root.findByType('dialog').props.className, 'learning-image-dialog is-desktop');
    await page.flushLayout();
    assert.equal(page.viewportScrollCalls.length, 1);
    assert.equal(page.viewportScrollCalls[0].element.props.className, 'learning-dialog-image');
    assert.deepEqual(page.viewportScrollCalls[0].options, { left: 1140, top: 680, behavior: 'instant' });
    await Renderer.act(async () => page.tree.root.findByType('dialog').props.onCancel({ preventDefault() {} }));
    assert.equal(document.body.style.overflow, '');
    assert.equal(page.dialogOpen, false);
    assert.match(page.focusTargets.at(-1), /^Увеличить скриншот:/);
    assert.deepEqual(
      h.learningZoomScroll(
        { x: 0.9, y: 0.9, width: 0.1, height: 0.1 },
        { width: 500, height: 300 },
        { width: 800, height: 600 },
      ),
      { left: 0, top: 0 },
    );
  } finally {
    page.destroy();
  }
});

test('ordinary Russian task questions keep meaningful words and show the matching action', async () => {
  browser();
  const h = loadLearning();
  const desktop = addDesktopFixture(h);
  const product = {
    ...desktop,
    slug: 'desktop-test-product',
    title: 'Создать товар',
    steps: [
      { ...desktop.steps[0], action: 'Добавьте масло на склад.', note: 'Тестовый пример.', title: 'Создайте товар' },
    ],
  };
  const salary = {
    ...desktop,
    slug: 'desktop-test-salary',
    topic: 'money',
    category: 'Зарплата',
    title: 'Зарплата сотрудников',
    steps: [{ ...desktop.steps[0], title: 'Откройте зарплату', action: 'Проверьте начисления за период.' }],
  };
  h.learningLessons.push(product, salary);
  assert.equal(h.rankLearningLessons([desktop, product, salary], 'как добавить товар')[0].lesson.slug, product.slug);
  assert.equal(
    h.rankLearningLessons([desktop, product, salary], 'где посмотреть зарплату')[0].lesson.slug,
    salary.slug,
  );
  assert.equal(h.rankLearningLessons([desktop, product, salary], 'где посмотреть зарплту')[0].lesson.slug, salary.slug);
  const page = await mount(h, '/obuchenie?platform=desktop&q=принятое%20количество');
  try {
    const row = page.tree.root
      .findAllByType('a')
      .find(
        (node) =>
          node.props.className === 'learning-lesson-row' &&
          new URL(node.props.href, 'https://example.test').pathname === `/obuchenie/${desktop.slug}`,
      );
    assert.ok(row);
    assert.match(allText(row), /Введите принятое количество товара/);
  } finally {
    page.destroy();
  }
});

test('genuine desktop overview search opens its client-link step and advances to the actual clients frame', async () => {
  browser();
  const h = loadLearning();
  h.saveLearningProgress('dobavit-klienta', 6, true);
  const page = await mount(h, '/obuchenie?platform=desktop&q=Найти%20клиента');
  try {
    const row = page.tree.root.findAllByType('a').find((node) => node.props.className === 'learning-lesson-row');
    assert.ok(row);
    const url = new URL(row.props.href, 'https://example.test');
    assert.equal(url.pathname, '/obuchenie/desktop-pervye-shagi');
    assert.equal(url.searchParams.get('step'), '3');
    await page.go(row.props.href);
    const image = () => page.tree.root.findByProps({ className: 'learning-image-button' });
    assert.equal(image().findByProps({ className: 'learning-hotspot' }).props.style.left, '68.5%');
    assert.equal(image().findByType('img').props.src, h.desktopAssets['desktop-dashboard-overview'].src);
    await page.click('Дальше');
    assert.equal(new URLSearchParams(page.location.search).get('platform'), 'desktop');
    assert.equal(new URLSearchParams(page.location.search).get('step'), '4');
    assert.equal(image().findByType('img').props.src, h.desktopAssets['desktop-clients-overview'].src);
    assert.match(allText(page.tree.toJSON()), /поле поиска клиентов/);
    assert.deepEqual(h.readLearningProgress().lessons['dobavit-klienta'], { step: 6, complete: true });
  } finally {
    page.destroy();
  }
});

// Tenant navigation inventory; internal platform/manager consoles are deliberately outside this catalog.
test('desktop task guides cover the exact 31 tenant feature IDs', () => {
  const h = loadLearning();
  const expected = [
    'dashboard',
    'cash_register_work_order',
    'appointments',
    'work_board',
    'work_order_journal',
    'clients',
    'cars',
    'calls',
    'marketing',
    'warehouse',
    'services',
    'suppliers',
    'purchase_orders',
    'equipment',
    'cashflow',
    'cash_shift',
    'installments',
    'expenses',
    'planning',
    'salary',
    'reports',
    'schedule',
    'employees',
    'motivation',
    'users',
    'branches',
    'knowledge_base',
    'company_settings',
    'integrations',
    'notifications',
    'tariff_subscription',
  ];
  const covered = new Set(
    h.learningLessons.filter((lesson) => lesson.platform === 'desktop').flatMap((lesson) => lesson.featureIds),
  );
  assert.deepEqual([...covered].sort(), expected.sort());
});

test('real catalog task questions rank the relevant guide and link directly to its matching action', async () => {
  const cases = [
    ['принять товар без заказа', 'desktop-oformit-postavku-bez-zakaza', 2],
    ['процент с продажи масел', 'desktop-nastroit-motivaciyu-na-tovary', 3],
    ['фикс мастеру', 'desktop-dobavit-uslugu-s-fiksirovannoy-cenoy', 8],
    ['история ремонта клиента', 'desktop-otkryt-chek-iz-istorii-klienta', 1],
    ['цена от до', 'desktop-dobavit-uslugu-s-diapazonom-ceny', 3],
    ['цены и себестоимость шаблона', 'desktop-proverit-tseny-v-shablone', 2],
    ['как добавить товар', 'desktop-dobavit-tovar-s-cenami', 1],
    ['где посмотреть зарплату', 'desktop-proverit-zarplatu-i-podgotovit-vyplatu', 1],
  ];
  browser();
  const h = loadLearning();
  const page = await mount(h, '/obuchenie');
  try {
    for (const [query, slug, step] of cases) {
      const ranked = h.rankLearningLessons(h.learningLessons, query, { platform: 'desktop' });
      assert.equal(ranked[0]?.lesson.slug, slug, query);
      assert.equal(ranked[0]?.step, step, query);
      await page.go('/obuchenie?' + new URLSearchParams({ platform: 'desktop', q: query }));
      const row = page.tree.root.findAllByType('a').find((node) => node.props.className === 'learning-lesson-row');
      const url = new URL(row.props.href, 'https://example.test');
      assert.equal(url.pathname, '/obuchenie/' + slug, query);
      assert.equal(url.searchParams.get('step'), String(step), query);
      assert.equal(url.searchParams.get('platform'), 'desktop');
      assert.equal(url.searchParams.get('q'), query);
      assert.ok(
        allText(row).includes(ranked[0].lesson.steps[step - 1].action),
        'visible result explains the matched action',
      );
    }
    assert.deepEqual(h.rankLearningLessons(h.learningLessons, 'процент с продажи несуществующего'), []);
  } finally {
    page.destroy();
  }
});

test('task creation searches open the start of the intended workflow, not incidental Create or Cancel text', async () => {
  browser();
  const h = loadLearning();
  const cases = [
    ['как создать шаблон чека', 'desktop-sohranit-shablon-cheka'],
    ['добавить сотрудника', 'desktop-podgotovit-dostup-sotrudniku'],
    ['создать сотрудника', 'desktop-podgotovit-dostup-sotrudniku'],
  ];
  const page = await mount(h, '/obuchenie');
  try {
    for (const [query, slug] of cases) {
      const best = h.rankLearningLessons(h.learningLessons, query, { platform: 'desktop' })[0];
      assert.equal(best?.lesson.slug, slug, query);
      assert.equal(best?.step, 1, query);
      await page.go('/obuchenie?' + new URLSearchParams({ platform: 'desktop', q: query }));
      const row = page.tree.root.findAllByType('a').find((node) => node.props.className === 'learning-lesson-row');
      const url = new URL(row.props.href, 'https://example.test');
      assert.equal(url.pathname, '/obuchenie/' + slug);
      assert.equal(url.searchParams.get('step'), '1');
    }
    assert.deepEqual(h.rankLearningLessons(h.learningLessons, 'создать шаблон несуществующее'), []);
    assert.deepEqual(h.rankLearningLessons(h.learningLessons, 'создать сотрудника', { platform: 'mobile' }), []);
  } finally {
    page.destroy();
  }
});

test('cold narrow desktop zoom waits for loaded image layout, centers once, and never snaps back on later events', async () => {
  browser();
  const h = loadLearning();
  addDesktopFixture(h);
  const page = await mount(h, '/obuchenie/desktop-test-priemka?platform=desktop&step=2', [], {
    imageReady: false,
    viewportWidth: 369,
    viewportHeight: 700,
  });
  try {
    await Renderer.act(async () => page.tree.root.findByProps({ className: 'learning-image-button' }).props.onClick());
    await page.flushLayout();
    assert.equal(
      page.viewportScrollCalls.length,
      0,
      'an unloaded image must not clamp the initial scroll to its empty layout',
    );
    const image = page.mockedNodes.filter((node) => node.element.type === 'img').at(-1);
    image.complete = true;
    image.naturalWidth = image.element.props.width;
    await Renderer.act(async () => image.events.get('load')?.forEach((handler) => handler()));
    await page.flushLayout();
    assert.equal(page.viewportScrollCalls.length, 1);
    assert.deepEqual(page.viewportScrollCalls[0].options, { left: 1571, top: 580, behavior: 'instant' });
    const viewport = page.mockedNodes.find((node) => node.element.props.className === 'learning-dialog-image');
    viewport.scrollLeft = 25;
    await Renderer.act(async () => {
      viewport.events.get('wheel')?.forEach((handler) => handler());
      image.events.get('load')?.forEach((handler) => handler());
    });
    await page.flushLayout();
    assert.equal(page.viewportScrollCalls.length, 1, 'late load/resize notifications must not undo manual pan');
    await Renderer.act(async () => page.tree.root.findByType('dialog').props.onCancel({ preventDefault() {} }));
    assert.equal(document.body.style.overflow, '');
    assert.match(page.focusTargets.at(-1), /^Увеличить скриншот:/);
    await Renderer.act(async () => page.tree.root.findByProps({ className: 'learning-image-button' }).props.onClick());
    const nextImage = page.mockedNodes.filter((node) => node.element.type === 'img').at(-1);
    const nextViewport = page.mockedNodes
      .filter((node) => node.element.props.className === 'learning-dialog-image')
      .at(-1);
    await Renderer.act(async () => nextViewport.events.get('wheel')?.forEach((handler) => handler()));
    nextImage.complete = true;
    nextImage.naturalWidth = nextImage.element.props.width;
    await Renderer.act(async () => nextImage.events.get('load')?.forEach((handler) => handler()));
    await page.flushLayout();
    assert.equal(page.viewportScrollCalls.length, 1, 'manual pan before a delayed image load also wins');
  } finally {
    page.destroy();
  }
});

test('catalog search and topic controls precede the optional featured lesson; row markers identify platform or completion', async () => {
  const storage = browser();
  const h = loadLearning();
  storage.set(h.LEARNING_PROGRESS_KEY, JSON.stringify({ lessons: { 'dobavit-klienta': { step: 6, complete: true } } }));
  const page = await mount(h, '/obuchenie');
  try {
    const nodes = page.tree.root.findAll((node) => typeof node.type === 'string');
    const feature = nodes.findIndex((node) => node.props['aria-labelledby'] === 'learning-start-title');
    assert.ok(feature > nodes.findIndex((node) => node.type === 'input' && node.props['aria-label'] === 'Найти урок'));
    assert.ok(feature > nodes.findIndex((node) => node.props['aria-label'] === 'Темы обучения'));
    const rows = page.tree.root.findAllByType('a').filter((node) => node.props.className === 'learning-lesson-row');
    for (const row of rows) {
      const slug = new URL(row.props.href, 'https://example.test').pathname.split('/').at(-1);
      const lesson = h.learningLessons.find((item) => item.slug === slug);
      const marker = row.findByProps({
        className: 'learning-lesson-marker' + (slug === 'dobavit-klienta' ? ' is-complete' : ''),
      });
      assert.equal(
        marker.props['aria-label'],
        slug === 'dobavit-klienta' ? 'Пройден' : lesson.platform === 'desktop' ? 'Компьютер' : 'Приложение',
      );
      assert.equal(allText(marker).trim(), '');
    }
  } finally {
    page.destroy();
  }
});
