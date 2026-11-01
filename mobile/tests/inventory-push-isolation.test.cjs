const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const babel = require('@babel/core');
const root = path.resolve(__dirname, '..');
function source(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return { text, ast: parser.parse(text, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) };
}
function executable(raw, globals) {
  const code = babel.transformSync('module.exports = ' + raw, {
    filename: 'isolation.tsx',
    configFile: false,
    babelrc: false,
    presets: [require.resolve('@babel/preset-typescript')],
  }).code;
  const context = { module: { exports: null }, ...globals };
  vm.runInNewContext(code, context);
  return context.module.exports;
}
function declaration(file, name, globals) {
  const f = source(file);
  let found;
  traverse(f.ast, {
    FunctionDeclaration(p) {
      if (p.node.id?.name === name) found = f.text.slice(p.node.start, p.node.end);
    },
  });
  assert.ok(found, name);
  return executable(found, globals);
}
function forbiddenNotifications() {
  const calls = [];
  return {
    calls,
    api: new Proxy(
      {},
      {
        get(_target, key) {
          calls.push(String(key));
          throw new Error('Unexpected OS notification access: ' + String(key));
        },
      },
    ),
  };
}

test('actual token registration returns before auth capture, permissions, Expo token acquisition or registration internally', async () => {
  const notifications = forbiddenNotifications();
  let captures = 0;
  const register = declaration('src/contexts/AuthContext.tsx', 'registerPushToken', {
    inventoryInternal: true,
    Notifications: notifications.api,
    captureAuthSession: () => {
      captures++;
      throw new Error('Unexpected auth/push access');
    },
  });
  await register();
  assert.equal(captures, 0);
  assert.deepEqual(notifications.calls, []);
  const ordinary = declaration('src/contexts/AuthContext.tsx', 'registerPushToken', {
    inventoryInternal: false,
    Notifications: notifications.api,
    captureAuthSession: () => {
      captures++;
      return { token: null };
    },
  });
  await ordinary();
  assert.equal(captures, 1);
});

test('actual foreground handler suppresses all internal notification presentation and retains public behavior', async () => {
  const f = source('App.tsx');
  let raw;
  traverse(f.ast, {
    CallExpression(p) {
      if (
        p.node.callee.type === 'MemberExpression' &&
        p.node.callee.object.name === 'Notifications' &&
        p.node.callee.property.name === 'setNotificationHandler'
      ) {
        raw = f.text.slice(p.node.arguments[0].start, p.node.arguments[0].end);
      }
    },
  });
  assert.ok(raw);
  for (const internal of [false, true]) {
    const handler = executable(raw, { inventoryInternal: internal });
    const result = await handler.handleNotification();
    for (const key of ['shouldShowAlert', 'shouldShowBanner', 'shouldShowList', 'shouldPlaySound'])
      assert.equal(result[key], !internal);
    assert.equal(result.shouldSetBadge, false);
  }
});

test('all actual push-listener effects leave the OS response untouched internally while own salary foreground polling remains', () => {
  const files = [
    'App.tsx',
    'src/contexts/SalaryNotificationContext.tsx',
    'src/contexts/BroadcastNotificationContext.tsx',
    'src/screens/CashierPaymentScreen.tsx',
    'src/navigation/PlatformReminderNotificationRouter.tsx',
  ];
  let effectCount = 0,
    polls = 0;
  for (const file of files) {
    const f = source(file);
    traverse(f.ast, {
      CallExpression(p) {
        const callee = p.node.callee;
        const isEffect =
          (callee.type === 'Identifier' && callee.name === 'useEffect') ||
          (callee.type === 'MemberExpression' && callee.property.name === 'useEffect');
        const callback = p.node.arguments[0];
        if (!isEffect || !callback) return;
        const raw = f.text.slice(callback.start, callback.end);
        if (!/Notifications\.(addNotification|getLastNotification)/.test(raw)) return;
        effectCount++;
        const notifications = forbiddenNotifications();
        const listeners = [];
        const effect = executable(raw, {
          inventoryInternal: true,
          Notifications: notifications.api,
          AppState: {
            addEventListener: (_name, listener) => {
              listeners.push(listener);
              return { remove() {} };
            },
          },
          checkOnce: () => {
            polls++;
          },
        });
        const cleanup = effect();
        for (const listener of listeners) listener('active');
        if (cleanup) cleanup();
        assert.deepEqual(notifications.calls, [], file);
      },
    });
  }
  assert.equal(effectCount, 6, 'Every current push listener/read/clear effect is exercised');
  assert.equal(polls, 1, 'Stage salary polling is independent of public OS pushes');
  const notifications = forbiddenNotifications();
  declaration('App.tsx', 'handleNotificationResponse', { inventoryInternal: true, Notifications: notifications.api })(
    undefined,
  );
  assert.deepEqual(notifications.calls, []);
});

test('internal offline delivery uses the in-app toast without OS permissions or scheduling', async () => {
  const notifications = forbiddenNotifications();
  const toasts = [];
  declaration('App.tsx', 'notifyQueuedCheckSent', {
    inventoryInternal: true,
    Notifications: notifications.api,
    captureDataSession: () => ({ owner: { userId: 'stage-user' }, isCurrent: () => true }),
    showToast: (...args) => toasts.push(args),
  })({}, { number: 7 });
  await new Promise(setImmediate);
  assert.deepEqual(notifications.calls, []);
  assert.equal(toasts.length, 1);
});
