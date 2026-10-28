/**
 * Runs the real table-header render branch with inert native hosts. This locks
 * the native-boundary contract from the iPhone regression; device raster/touch
 * verification remains separate. No report queries or financial fixtures run.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

type Target = 'Cell' | 'Measurement' | 'StickyHeader';
type RowProps = {
  model: object;
  palette: object;
  sort: object;
  onSort: (key: string, type: string) => void;
};
type HeaderProps = {
  collapsable?: boolean;
  collapsableChildren?: boolean;
  style: unknown[];
  children: React.ReactElement<RowProps>;
};

function fixture() {
  // The override reproduces the pre-fix failure without rolling back source.
  const filename = process.env.AUTEXA_REPORT_RUN_SOURCE_TEST_ONLY || resolve(__dirname, '../ReportRunScreen.tsx');
  const source = ts.createSourceFile(
    filename,
    readFileSync(filename, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let header: ts.ReturnStatement | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) && node.expression.text === 'table-header') {
      header = node.statements.find(ts.isReturnStatement);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (!header) throw new Error('The real report table-header render branch is missing');
  const output = ts.transpileModule(`module.exports = function renderHeader(target) { ${header.getText(source)} };`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const model = { fixture: 'existing table model' };
  const palette = { fixture: 'existing palette' };
  const sort = { key: 'revenue', direction: 'asc' };
  const onSort = jest.fn();
  const gutter = { paddingHorizontal: 16 };
  const offset = { paddingTop: 122 };
  const module = { exports: undefined as unknown };
  new Function(
    'React',
    'Animated',
    'ReportHeaderRow',
    'styles',
    'models',
    'palette',
    'sort',
    'handleSort',
    'stickyHeaderOffset',
    'module',
    output,
  )(
    React,
    { View: 'AnimatedView' },
    'ReportHeaderRow',
    { gutter },
    { main: model },
    palette,
    sort,
    onSort,
    offset,
    module,
  );
  const render = module.exports as (target: Target) => React.ReactElement<HeaderProps>;
  return { render, model, palette, sort, onSort, gutter, offset };
}

it('retains the sticky row native boundary and the already measured island offset', () => {
  const f = fixture();
  const sticky = f.render('StickyHeader');
  expect(sticky.props.collapsableChildren).toBe(false);
  expect(sticky.props.collapsable).toBe(false);
  expect(sticky.props.style).toEqual([f.gutter, f.offset]);
});

it.each<Target>(['Cell', 'Measurement'])('leaves %s geometry and native optimization untouched', (target) => {
  const f = fixture();
  const row = f.render(target);
  expect(row.props.collapsableChildren).toBeUndefined();
  expect(row.props.collapsable).toBeUndefined();
  expect(row.props.style).toEqual([f.gutter, false]);
});

it('passes the same table model and sort handler into the native sticky row', () => {
  const f = fixture();
  const row = f.render('StickyHeader').props.children;
  expect(row.props.model).toBe(f.model);
  expect(row.props.palette).toBe(f.palette);
  expect(row.props.sort).toBe(f.sort);
  expect(row.props.onSort).toBe(f.onSort);
  row.props.onSort('revenue', 'money');
  expect(f.onSort).toHaveBeenCalledWith('revenue', 'money');
});
