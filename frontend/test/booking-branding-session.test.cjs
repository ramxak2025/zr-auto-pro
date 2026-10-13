const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const Module = require('node:module');
const ts = require('typescript');
for (const extension of ['.ts', '.tsx'])
  require.extensions[extension] = (module, filename) =>
    module._compile(
      ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: {
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText,
      filename,
    );
require.extensions['.css'] = () => {};
const React = require('react');
const Renderer = require('react-test-renderer');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let auth = {
  user: { id: 'owner-A', currentPointId: 'point-A', tenant: { name: 'Сервис A' } },
  token: 'token-A',
  hasPermission: () => true,
};
let finish;
const deferred = () =>
  new Promise((resolve) => {
    finish = resolve;
  });
let response = deferred();
const calls = [];
const originalLoad = Module._load;
const queryClient = { setQueryData() {}, invalidateQueries() {} };
Module._load = function (name, parent, isMain) {
  if (name === '../contexts/AuthContext') return { useAuth: () => auth };
  if (name === '../api/axios') return { createSessionBoundClient: (token) => ({ token }) };
  if (name === '../utils/sessionToken') return { readStoredToken: () => auth.token };
  if (name.endsWith('/api/createServices'))
    return {
      createClientsApi: () => ({}),
      createBookingsApi: (client) => ({
        uploadPublicBranding: (form) => {
          calls.push({ token: client.token, form });
          return response;
        },
      }),
    };
  if (name === '@tanstack/react-query')
    return {
      useQueryClient: () => queryClient,
      useQuery: (options) => ({
        data: options.queryKey[1] === 'public-settings' ? null : [],
        isLoading: false,
        isError: false,
      }),
      useMutation: () => ({ isPending: false, mutate() {} }),
    };
  if (name === '../ui')
    return Object.fromEntries(
      ['Button', 'Card', 'CardBody', 'CardHeader', 'Field', 'Input', 'PageHeader', 'Select'].map((key) => [
        key,
        (props) => React.createElement(key, props, props.children),
      ]),
    );
  if (name === 'react-hot-toast') return { __esModule: true, default: { success() {}, error() {} } };
  return originalLoad.call(this, name, parent, isMain);
};
const Page = require('../src/pages/BookingsPage').default;
Module._load = originalLoad;
const Editor = require('../src/components/booking/BookingBrandingEditor').default;
function render() {
  let tree;
  Renderer.act(() => {
    tree = Renderer.create(React.createElement(Page));
  });
  return tree;
}
const upload = (tree) =>
  Renderer.act(() =>
    tree.root.findByType(Editor).props.onUpload('logoUrl', new Blob(['image'], { type: 'image/png' })),
  );
test('late image upload cannot cross owner, branch or A→B→A session boundaries', async () => {
  for (const change of ['branch', 'account', 'token']) {
    auth = {
      user: { id: 'owner-A', currentPointId: 'point-A', tenant: { name: 'Сервис A' } },
      token: 'token-A',
      hasPermission: () => true,
    };
    response = deferred();
    const tree = render();
    upload(tree);
    assert.equal(tree.root.findByType(Editor).props.uploading, 'logoUrl');
    const original = auth;
    auth =
      change === 'branch'
        ? { ...auth, user: { ...auth.user, currentPointId: 'point-B' } }
        : change === 'account'
          ? { ...auth, user: { ...auth.user, id: 'owner-B' }, token: 'token-B' }
          : { ...auth, token: 'token-B' };
    Renderer.act(() => tree.update(React.createElement(Page)));
    // Return to A before its original upload finishes: the old generation is still stale.
    auth = original;
    Renderer.act(() => tree.update(React.createElement(Page)));
    await Renderer.act(async () => {
      finish({ data: { url: '/api/uploads/old-owner.webp' } });
      await response;
    });
    assert.equal(tree.root.findByType(Editor).props.logoUrl, undefined);
    assert.equal(tree.root.findByType(Editor).props.uploading, null);
    Renderer.act(() => tree.unmount());
  }
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.token === 'token-A' && call.form instanceof FormData));
});
test('current upload changes only the draft; explicit removal is null and cannot silently republish', async () => {
  response = deferred();
  const tree = render();
  upload(tree);
  await Renderer.act(async () => {
    finish({ data: { url: '/api/uploads/current-logo.webp' } });
    await response;
  });
  assert.equal(tree.root.findByType(Editor).props.logoUrl, '/api/uploads/current-logo.webp');
  Renderer.act(() => tree.root.findByType(Editor).props.onRemove('logoUrl'));
  assert.equal(tree.root.findByType(Editor).props.logoUrl, null);
  Renderer.act(() => tree.unmount());
});
