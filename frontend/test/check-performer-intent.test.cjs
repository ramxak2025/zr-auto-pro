// Executes the production page's pure payload/hydration functions, not a UI snapshot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/pages/CheckCreatePage.tsx');
const source = fs.readFileSync(filename, 'utf8');
const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['checkPerformerPayload', 'confirmedCheckPerformers']);
const declarations = parsed.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(declarations.length, 2);
const compiled = ts.transpileModule(declarations.map((node) => node.getFullText(parsed)).join('\n'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const loaded = new Module(filename, module);
loaded._compile(compiled, filename);
const { checkPerformerPayload, confirmedCheckPerformers } = loaded.exports;

test('untouched legacy edit never promotes the administrator default to a confirmed performer', () => {
  const visible = confirmedCheckPerformers(false, [{ id: 'administrator' }]);
  assert.deepEqual(visible, []);
  assert.deepEqual(checkPerformerPayload(true, false, visible), {});
  assert.deepEqual(confirmedCheckPerformers(undefined, [{ id: 'legacy-master' }]), []);
});

test('confirmed historical choices remain visible; only deliberate edit/clear sends intent', () => {
  const visible = confirmedCheckPerformers(true, [{ id: 'one' }, { id: 'two' }]);
  assert.deepEqual(visible, ['one', 'two']);
  assert.deepEqual(checkPerformerPayload(true, false, visible), {});
  assert.deepEqual(checkPerformerPayload(true, true, ['one', 'one']), {
    assigneeIds: ['one'],
    assigneesConfirmed: true,
  });
  assert.deepEqual(checkPerformerPayload(true, true, []), { assigneeIds: [], assigneesConfirmed: true });
});

test('new check explicitly sends the visible selection including unassigned admin, never an implicit fallback', () => {
  assert.deepEqual(checkPerformerPayload(false, false, []), { assigneeIds: [], assigneesConfirmed: true });
  assert.deepEqual(checkPerformerPayload(false, false, ['self']), { assigneeIds: ['self'], assigneesConfirmed: true });
  // Check the actual submit consumes this boundary, rather than testing a disconnected utility.
  assert.match(source, /\.\.\.checkPerformerPayload\(isEditMode, assigneesDirty, assigneeIds\)/);
  assert.match(source, /user\?\.role === 'master'[\s\S]{0,100}posSettings\?\.isCashier === false/);
  assert.match(source, /setAssigneesDirty\(true\)/);
});
