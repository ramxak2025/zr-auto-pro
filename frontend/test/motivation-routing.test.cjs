const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('../node_modules/typescript');
const React = require('../node_modules/react');
const { Routes, Route, Navigate, createRoutesFromChildren, matchRoutes } = require('../node_modules/react-router-dom');

// Execute the real App's route JSX with inert page components. This checks
// React Router's static/dynamic ranking without mounting auth or API providers.
function appRoutes(signedIn) {
  const source = ts.createSourceFile(
    'App.tsx',
    fs.readFileSync(path.join(__dirname, '../src/App.tsx'), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let routes;
  const context = { module: { exports: undefined } };
  function visit(node) {
    if (ts.isIdentifier(node)) {
      const name = node.text;
      context[name] = /^[A-Z]/.test(name) ? Object.assign(() => null, { displayName: name }) : false;
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Routes') routes = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(routes, 'App must expose its actual Routes JSX');
  Object.assign(context, {
    React,
    Routes,
    Route,
    Navigate,
    subscriptionBlocked: false,
    user: signedIn ? { role: 'director' } : null,
    homePathFor: () => '/dashboard',
    gated: (_permission, element) => element,
  });
  const code = ts.transpileModule(`module.exports = (${routes.getText(source)});`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, context);
  return createRoutesFromChildren(context.module.exports.props.children);
}

function destination(routes, pathname) {
  return matchRoutes(routes, pathname)?.at(-1)?.route.element;
}

test('motivation logout matches the exact login redirect instead of the public booking route', () => {
  const before = destination(appRoutes(true), '/motivation');
  assert.equal(before.type.displayName, 'MotivationPage');
  const after = destination(appRoutes(false), '/motivation');
  assert.equal(after.type, Navigate);
  assert.equal(after.props.to, '/login');
  assert.equal(after.props.replace, true);
});

test('real short booking codes and the legacy booking route stay public in both sessions', () => {
  for (const signedIn of [false, true]) {
    const routes = appRoutes(signedIn);
    for (const pathname of ['/Abcd0123EfGh4567', `/${'a'.repeat(32)}`, '/book/service-qa']) {
      assert.equal(destination(routes, pathname).type.displayName, 'PublicBookingPage');
    }
  }
});
