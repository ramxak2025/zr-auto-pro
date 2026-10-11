const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const screensRoot = path.join(__dirname, '../src/screens');
const excludedFiles = new Set(['AccountPickerSheet.tsx', 'LoginScreen.tsx']);
const scrollSymbols = new Set(['ScrollView', 'FlatList', 'FlashList']);

function listTsxFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listTsxFiles(filePath);
    return entry.isFile() && filePath.endsWith('.tsx') ? [filePath] : [];
  });
}

function parseScreen(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(
    sourceFile.parseDiagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')),
    [],
    `${path.relative(screensRoot, filePath)} must parse as TSX`,
  );
  return sourceFile;
}

function collectScreenData(filePath) {
  const sourceFile = parseScreen(filePath);
  const wrappers = new Map();
  const directImports = [];

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const moduleName = statement.moduleSpecifier.text;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    for (const specifier of bindings.elements) {
      const importedName = specifier.propertyName?.text ?? specifier.name.text;
      const localName = specifier.name.text;
      if ((moduleName === 'react-native' || moduleName === '@shopify/flash-list') && scrollSymbols.has(importedName)) {
        directImports.push(`${moduleName}:${importedName}`);
      }
      if (moduleName.endsWith('/components/TabBarScrollable') && importedName.startsWith('TabBar')) {
        wrappers.set(localName, importedName);
      }
    }
  }

  const modalPlacements = [];
  const ancestors = [];
  function visit(node) {
    if (ts.isJsxElement(node)) {
      ancestors.push(node.openingElement.tagName.getText(sourceFile));
      visit(node.openingElement);
      for (const child of node.children) visit(child);
      ancestors.pop();
      return;
    }
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const localName = node.tagName.getText(sourceFile);
      if (wrappers.has(localName) && ancestors.some((name) => /Modal|Sheet$/i.test(name))) {
        const hasOptOut = node.attributes.properties.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            attribute.name.getText(sourceFile) === 'reserveBottomNavigation' &&
            attribute.initializer?.getText(sourceFile) === '{false}',
        );
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        modalPlacements.push({ line: line + 1, hasOptOut });
      }
    }
    if (ts.isJsxFragment(node)) {
      for (const child of node.children) visit(child);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return { directImports, modalPlacements };
}

const includedScreens = listTsxFiles(screensRoot).filter((filePath) => !excludedFiles.has(path.basename(filePath)));

test('screen scrolling primitives come from TabBarScrollable', () => {
  const violations = [];
  for (const filePath of includedScreens) {
    const { directImports } = collectScreenData(filePath);
    for (const importedPrimitive of directImports) {
      violations.push(`${path.relative(screensRoot, filePath)} imports ${importedPrimitive} directly`);
    }
  }
  assert.deepEqual(violations, []);
});

test('scrolling primitives inside modal and sheet JSX opt out of tab-bar reservation', () => {
  const violations = [];
  for (const filePath of includedScreens) {
    const { modalPlacements } = collectScreenData(filePath);
    for (const placement of modalPlacements) {
      if (!placement.hasOptOut) {
        violations.push(`${path.relative(screensRoot, filePath)}:${placement.line} is missing reserveBottomNavigation={false}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
