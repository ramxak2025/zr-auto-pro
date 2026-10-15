const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const Renderer = require('react-test-renderer');
function load(filename, mocks = {}) {
  const m = new Module(filename, module); m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = m.require.bind(m); m.require = (id) => id in mocks ? mocks[id] : original(id);
  m._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName:filename,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText, filename); return m.exports;
}
const helper = load(path.resolve(__dirname, '../../shared/utils/subscriptionPricing.ts'));
const { PricingCalculator } = load(path.resolve(__dirname, '../src/pages/landing/sections/PricingCalculator.tsx'), {'../../../../../shared/utils/subscriptionPricing':helper});
function mount(period) { let tree; Renderer.act(()=>{tree=Renderer.create(React.createElement(PricingCalculator,{period}));}); return tree; }
const total = tree => tree.root.findByProps({'data-testid':'subscription-total'}).children.join('').replace(/\s/g,'');
const choose = (tree, name) => Renderer.act(()=>tree.root.findAllByType('button').find(n=>n.children.join('')===name).props.onClick());
const fill = (tree,label,value) => Renderer.act(()=>tree.root.findByProps({'aria-label':label}).props.onChange({target:{value}}));

test('public calculator: annual BAZA/PRO/MAX and extra branches use full composition through real controls',()=>{
 const tree=mount('yearly'); assert.equal(total(tree),'49900₽');
 fill(tree,'Всего сотрудников','6');assert.equal(total(tree),'54900₽');
 choose(tree,'BAZA'); fill(tree,'Всего сотрудников','2');assert.equal(total(tree),'19800₽');
 choose(tree,'MAX');fill(tree,'Всего сотрудников','51');fill(tree,'Всего филиалов','2');assert.equal(total(tree),'205000₽');
 Renderer.act(()=>tree.update(React.createElement(PricingCalculator,{period:'monthly'})));assert.equal(total(tree),'20500₽');
 Renderer.act(()=>tree.unmount());
});
test('public calculator: invalid and unsafe input never exposes an old payable total',()=>{
 const tree=mount('monthly');
 for(const invalid of ['', '0', '-1', '1.5', '1e3', '9007199254740992']) {
  fill(tree,'Всего сотрудников',invalid);assert.equal(tree.root.findAllByProps({'data-testid':'subscription-total'}).length,0,invalid);assert.equal(tree.root.findByProps({'aria-label':'Всего сотрудников'}).props['aria-invalid'],true);
 }
 fill(tree,'Всего сотрудников','1');assert.equal(total(tree),'4990₽');Renderer.act(()=>tree.unmount());
});
