import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
const dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  process.env.AUTEXA_RESET_SOURCE_TEST_ONLY || path.join(dirname, '../src/screens/admin/ResetOwnerPasswordSheet.tsx'),
  'utf8',
);
const children = (node) =>
  node && typeof node === 'object' && node.props
    ? [node, ...React.Children.toArray(node.props.children).flatMap(children)]
    : [];
const text = (node) =>
  typeof node === 'string' ? node : node?.props ? React.Children.toArray(node.props.children).map(text).join('') : '';
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const alerts = [],
    shares = [],
    requests = [],
    invalidations = [];
  let current = true,
    closed = 0,
    instance;
  const hooks = {
    ...React,
    useState(value) {
      const i = instance.cursor++;
      if (!instance.slots[i]) instance.slots[i] = { value: typeof value === 'function' ? value() : value };
      const owned = instance,
        slot = instance.slots[i];
      return [
        slot.value,
        (next) => {
          if (!owned.mounted) owned.postUnmountWrites++;
          slot.value = typeof next === 'function' ? next(slot.value) : next;
        },
      ];
    },
    useRef(value) {
      const i = instance.cursor++;
      if (!instance.slots[i]) instance.slots[i] = { current: value };
      return instance.slots[i];
    },
    useEffect(fn, deps) {
      const i = instance.cursor++,
        old = instance.slots[i];
      if (!old || !deps || deps.some((v, index) => v !== old.deps[index])) {
        const slot = { deps, cleanup: old?.cleanup };
        instance.slots[i] = slot;
        instance.effects.push(() => {
          slot.cleanup?.();
          slot.cleanup = fn();
        });
      }
    },
  };
  hooks.useLayoutEffect = hooks.useEffect;
  hooks.useCallback = (fn) => fn;
  hooks.useSyncExternalStore = (subscribe, getSnapshot) => {
    hooks.useEffect(() => subscribe(() => {}), [subscribe]);
    return getSnapshot();
  };
  const session = {
    data: { generation: 1, owner: { userId: 'operator-A' } },
    authEpoch: 1,
    isCurrent: () => current,
    manager: {
      resetOwnerPassword: (id, data) => new Promise((resolve, reject) => requests.push({ id, data, resolve, reject })),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText,
    {
      exports: module.exports,
      require(name) {
        if (name === 'react') return { ...hooks, default: hooks };
        if (name === 'react-native')
          return {
            Alert: { alert: (...args) => alerts.push(args) },
            Share: {
              share: (value) => {
                shares.push(value);
                return Promise.resolve();
              },
            },
            View: 'View',
            Pressable: 'Pressable',
          };
        if (name === '@tanstack/react-query') return { useQueryClient: () => ({}) };
        if (name.endsWith('/phone')) return { formatPhone: String };
        if (name.endsWith('/Typography')) return { Text: 'Text' };
        if (name.endsWith('/ThemeContext'))
          return { useColors: () => ({ text: { primary: '#111', secondary: '#444' }, accent: { primary: '#00f' } }) };
        if (name === './adminShared') return { invalidatePlatformQueries: (_client, id) => invalidations.push(id) };
        if (name === './adminSheet')
          return { AdminSheet: 'AdminSheet', SheetHint: 'SheetHint', SheetPasswordField: 'PasswordField' };
        if (name === './usePlatformData') return { usePlatformSession: () => ({ session, allowed: true }) };
        if (name === './platformSession')
          return {
            assertPlatformSession: () => {
              if (!current) throw new Error('stale');
            },
          };
        throw new Error(`Unexpected import: ${name}`);
      },
    },
  );
  const outer = module.exports.default;
  let props = { visible: true, tenant: { id: 'tenant-A', name: 'Клиент А' }, onClose: () => closed++ },
    tree,
    key;
  const unmount = () => {
    if (!instance) return;
    instance.mounted = false;
    for (const slot of instance.slots) slot?.cleanup?.();
  };
  const render = (next = {}) => {
    props = { ...props, ...next };
    const content = outer(props);
    if (!instance || !instance.mounted || key !== content.key) {
      unmount();
      key = content.key;
      instance = { slots: [], cursor: 0, effects: [], mounted: true, postUnmountWrites: 0 };
    }
    instance.cursor = 0;
    instance.effects = [];
    tree = content.type(content.props);
    for (const effect of instance.effects) effect();
    return tree;
  };
  const field = () => children(tree).find((node) => node.type === 'PasswordField');
  const save = () =>
    children(tree)
      .find((node) => node.type === 'AdminSheet')
      .props.onSave();
  const close = () =>
    children(tree)
      .find((node) => node.type === 'AdminSheet')
      .props.onClose();
  const fill = (password = 'secret-once-A') => {
    field().props.onChangeText(password);
    render();
  };
  const revealCount = (password = 'secret-once-A') =>
    alerts.filter((entry) => entry[1]?.includes(password)).length +
    children(tree).filter((node) => node.type === 'Text' && text(node).includes(password)).length;
  const shareButton = () => {
    const alert = alerts.find((entry) => entry[1]?.includes('secret-once-A'));
    if (alert) return alert[2].find((button) => button.text === 'Поделиться').onPress;
    return children(tree).find((node) => node.type === 'Pressable' && text(node).includes('Поделиться'))?.props.onPress;
  };
  render();
  return {
    render,
    fill,
    save,
    close,
    unmount,
    requests,
    alerts,
    shares,
    invalidations,
    revealCount,
    shareButton,
    get closed() {
      return closed;
    },
    get tree() {
      return tree;
    },
    get postUnmountWrites() {
      return instance.postUnmountWrites;
    },
    switchSession: () => {
      current = false;
    },
    sameOperatorLogin: () => {
      current = true;
      session.data.generation++;
      session.authEpoch++;
    },
  };
}
test('deferred reset serializes same-tenant reopen and prevents reversed completion from replacing its secret', async () => {
  const f = fixture();
  f.fill();
  f.save();
  assert.equal(f.requests.length, 1);
  f.close();
  f.render({ visible: false });
  f.render({ visible: true });
  f.fill('new-secret-B');
  f.save();
  assert.equal(f.requests.length, 1);
  assert.equal(children(f.tree).find((node) => node.type === 'AdminSheet').props.saving, true);
  assert.equal(children(f.tree).find((node) => node.type === 'AdminSheet').props.saveDisabled, true);
  assert.ok(text(f.tree).includes('Сброс пароля ещё выполняется'));
  const closedBefore = f.closed;
  f.requests[0].resolve({ data: { ok: true } });
  await tick();
  f.render();
  assert.equal(f.alerts.length, 0);
  assert.equal(f.closed, closedBefore);
  assert.equal(f.revealCount(), 0);
  assert.equal(children(f.tree).find((node) => node.type === 'PasswordField').props.value, 'new-secret-B');
  assert.equal(children(f.tree).find((node) => node.type === 'AdminSheet').props.saving, false);
  f.save();
  assert.equal(f.requests.length, 2);
  f.requests[1].resolve({ data: { ok: true } });
  await tick();
  f.render();
  assert.equal(f.revealCount('new-secret-B'), 1);
  assert.equal(f.revealCount(), 0);
});
test('deferred success after unmount or tenant-key change has no secret or side effects', async () => {
  for (const change of ['unmount', 'tenant']) {
    const f = fixture();
    f.fill();
    f.save();
    if (change === 'unmount') f.unmount();
    else f.render({ tenant: { id: 'tenant-B', name: 'Клиент Б' } });
    f.requests[0].resolve({ data: { ok: true } });
    await tick();
    assert.equal(f.alerts.length, 0);
    assert.equal(f.closed, 0);
    assert.equal(f.invalidations.length, 0);
    if (change === 'unmount') assert.equal(f.postUnmountWrites, 0);
  }
});
test('stale rejection after close/reopen or unmount cannot show errors in a newer lifetime', async () => {
  for (const change of ['reopen', 'unmount']) {
    const f = fixture();
    f.fill();
    f.save();
    if (change === 'unmount') f.unmount();
    else {
      f.close();
      f.render({ visible: false });
      f.render({ visible: true });
    }
    f.requests[0].reject(new Error('timeout'));
    await tick();
    assert.equal(f.alerts.length, 0);
  }
});
test('current successful reset reveals once and stale share callbacks cannot export it after close/reopen', async () => {
  const f = fixture();
  f.fill();
  f.save();
  f.requests[0].resolve({ data: { ok: true } });
  await tick();
  f.render();
  assert.equal(f.revealCount(), 1);
  assert.equal(f.invalidations.length, 1);
  const share = f.shareButton();
  assert.ok(share);
  share();
  await tick();
  assert.equal(f.shares.length, 1);
  f.save();
  assert.equal(f.closed, 1);
  f.render({ visible: false });
  f.render({ visible: true });
  share();
  await tick();
  assert.equal(f.shares.length, 1);
  assert.equal(f.revealCount(), 0);
});
test('account replacement suppresses delayed completion and current rejection permits a safe retry', async () => {
  const stale = fixture();
  stale.fill();
  stale.save();
  stale.switchSession();
  stale.requests[0].resolve({ data: { ok: true } });
  await tick();
  assert.equal(stale.alerts.length, 0);
  const current = fixture();
  current.fill();
  current.save();
  current.requests[0].reject(new Error('timeout'));
  await tick();
  current.render();
  assert.equal(current.alerts.length, 1);
  assert.equal(current.revealCount(), 0);
  current.save();
  assert.equal(current.requests.length, 2);
});
test('cached director identity is never attached to a password after the owner changes during reset', async () => {
  const f = fixture();
  f.render({
    tenant: { id: 'tenant-A', name: 'Клиент А', owner: { fullName: 'Прежний Директор', phone: '+79991234567' } },
  });
  f.fill();
  f.save();
  f.render({
    tenant: { id: 'tenant-A', name: 'Клиент А', owner: { fullName: 'Новый Директор', phone: '+79997654321' } },
  });
  f.requests[0].resolve({ data: { ok: true } });
  await tick();
  f.render();
  assert.equal(f.revealCount(), 1);
  const share = f.shareButton();
  assert.ok(share);
  share();
  await tick();
  const revealed = [...f.alerts.map((entry) => entry[1]), text(f.tree), ...f.shares.map((entry) => entry.message)].join(
    '\n',
  );
  for (const identity of ['Прежний Директор', 'Новый Директор', '+79991234567', '+79997654321'])
    assert.equal(revealed.includes(identity), false);
});

test('callbacks retained from a success cannot share or close after unmount or tenant change', async () => {
  for (const change of ['unmount', 'tenant']) {
    const f = fixture();
    f.fill();
    f.save();
    f.requests[0].resolve({ data: { ok: true } });
    await tick();
    f.render();
    const share = f.shareButton(),
      done = children(f.tree).find((node) => node.type === 'AdminSheet').props.onSave;
    if (change === 'unmount') f.unmount();
    else f.render({ tenant: { id: 'tenant-B', name: 'Клиент Б' } });
    const closedBefore = f.closed;
    share();
    done();
    await tick();
    assert.equal(f.shares.length, 0);
    assert.equal(f.closed, closedBefore);
    if (change === 'unmount') assert.equal(f.postUnmountWrites, 0);
  }
});

test('unmount and same-operator login cannot bypass an unsettled reset; a rejected transport releases it', async () => {
  for (const change of ['remount', 'same-operator-login']) {
    const f = fixture();
    f.fill();
    f.save();
    f.unmount();
    if (change === 'same-operator-login') f.sameOperatorLogin();
    f.render();
    f.fill('secret-next-B');
    f.save();
    assert.equal(f.requests.length, 1);
    assert.equal(children(f.tree).find((node) => node.type === 'AdminSheet').props.saving, true);
    f.requests[0].reject(new Error('network timeout'));
    await tick();
    f.render();
    assert.equal(f.alerts.length, 0);
    assert.equal(f.revealCount(), 0);
    assert.equal(children(f.tree).find((node) => node.type === 'AdminSheet').props.saving, false);
    f.save();
    assert.equal(f.requests.length, 2);
    f.requests[1].resolve({ data: { ok: true } });
    await tick();
    f.render();
    assert.equal(f.revealCount('secret-next-B'), 1);
  }
});
