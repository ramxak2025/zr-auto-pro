const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}
const clock = { exports: {} };
vm.runInNewContext(
  compile(fs.readFileSync(path.join(__dirname, '../../shared/utils/checkDateTime.ts'), 'utf8')),
  clock,
);
const source = fs.readFileSync(
  process.env.AUTEXA_PICKER_SOURCE_TEST_ONLY || path.join(__dirname, '../src/components/DateTimePickerModal.tsx'),
  'utf8',
);
const native = {
  Platform: { OS: 'android' },
  StyleSheet: { create: (x) => x },
  Alert: { alert: () => assert.fail('Unexpected invalid time') },
};
for (const name of ['View', 'Text', 'TouchableOpacity', 'Modal', 'ScrollView']) native[name] = name;
const tokens = new Proxy({}, { get: () => 16 });
const sandbox = {
  exports: {},
  require(name) {
    if (name === 'react') return { ...React, default: React };
    if (name === 'react-native') return native;
    if (name.endsWith('/checkDateTime')) return clock.exports;
    if (name === '../theme')
      return {
        colors: new Proxy({}, { get: () => tokens }),
        spacing: tokens,
        fontSize: tokens,
        fontWeight: tokens,
        borderRadius: tokens,
      };
    return {};
  },
};
// Instrument only the in-memory test copy; production exports stay unchanged.
vm.runInNewContext(compile(source + '\nexport const privateProbe = { TimePicker };'), sandbox);
const palette = {
  accent: { primary: '#00f', primarySoft: '#eef', primaryText: '#00f' },
  bg: { muted: '#fff' },
  text: { secondary: '#333' },
};
const all = (node) =>
  node && typeof node === 'object' && node.props
    ? [node, ...React.Children.toArray(node.props.children).flatMap(all)]
    : [];
const text = (node) =>
  typeof node === 'string' ? node : node?.props ? React.Children.toArray(node.props.children).map(text).join('') : '';
function picker(timeZone) {
  let actual;
  const value = new Date('2026-10-12T00:17:30Z');
  const tree = sandbox.exports.privateProbe.TimePicker({ value, timeZone, p: palette, onChange: (d) => (actual = d) });
  return { tree, value, read: () => actual };
}
test('Android quick time presets use the service timezone', () => {
  const p = picker('Asia/Vladivostok');
  const preset = all(p.tree).find((x) => x.type === 'TouchableOpacity' && text(x) === '09:00');
  assert.ok(preset);
  preset.props.onPress();
  assert.equal(p.read().toISOString(), '2026-10-11T23:00:30.000Z');
  assert.equal(p.value.toISOString(), '2026-10-12T00:17:30.000Z');
});
test('Android hour and minute arrows use the same service clock', () => {
  const p = picker('Asia/Vladivostok');
  const buttons = all(p.tree).filter((x) => x.type === 'TouchableOpacity');
  buttons[0].props.onPress();
  assert.equal(p.read().toISOString(), '2026-10-12T01:17:30.000Z');
  buttons[2].props.onPress();
  assert.equal(p.read().toISOString(), '2026-10-12T00:22:30.000Z');
});
test('existing callers without a timezone keep device-local presets', () => {
  const p = picker(undefined);
  all(p.tree)
    .find((x) => x.type === 'TouchableOpacity' && text(x) === '09:00')
    .props.onPress();
  assert.equal(p.read().getHours(), 9);
  assert.equal(p.read().getMinutes(), 0);
});

test('new check time selection can choose any exact minute', () => {
  let actual;
  const tree = sandbox.exports.privateProbe.TimePicker({
    value: new Date('2026-10-11T23:00:00Z'),
    timeZone: 'Asia/Vladivostok',
    minuteStep: 1,
    p: palette,
    onChange: (d) => (actual = d),
  });
  const buttons = all(tree).filter((x) => x.type === 'TouchableOpacity');
  buttons[2].props.onPress();
  assert.equal(actual.toISOString(), '2026-10-11T23:01:00.000Z');
});
