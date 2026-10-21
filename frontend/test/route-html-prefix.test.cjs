const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Run the real classifier in a bounded child: a future regexp regression must
// fail this test instead of freezing the main Node/React test process.
test('HTML prefix classification handles long comment/prolog chains in bounded time', () => {
  const classifier = path.resolve(__dirname, '../src/api/routeFailure.ts');
  const worker = String.raw`
    const assert = require('node:assert/strict');
    const fs = require('node:fs');
    const ts = require('typescript');
    const source = fs.readFileSync(process.argv[1], 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const loaded = { exports: {} };
    new Function('module', 'exports', compiled)(loaded, loaded.exports);
    const { isHtmlApiResponse } = loaded.exports;
    const check = (data, expected, contentType = 'application/json') => assert.equal(isHtmlApiResponse({ data, headers: { 'content-type': contentType } }), expected);
    const comments = ' \t<!--x-->\n'.repeat(100000);
    check(comments + 'not html', false);
    check(comments + '<!DOCTYPE html><html><body>Portal</body></html>', true);
    const mixed = '\ufeff <?XmL version="1.0"?> <!--x--> \n'.repeat(40000);
    check(mixed + 'name,amount\nfixture,1', false);
    check(mixed + '<HTML lang="ru"><body>Portal</body></HTML>', true);
    for (const prefix of ['<!-- no end <html>', '<?xml version="1.0" <html>', '<!--ok--> <?XmL no end']) check(prefix, false);
    check('name,note\nfixture,<!-- comment --> <html>', false);
    check({ message: 'Unauthorized' }, false);
    check(null, false);
    check(401, false);
    check({ any: 'body' }, true, 'text/html; charset=UTF-8');
    check('plain', true, 'application/xhtml+xml');
    process.stdout.write('long-prefix classifier checks passed');
  `;
  const output = execFileSync(process.execPath, ['-e', worker, classifier], {
    cwd: path.resolve(__dirname, '..'),
    timeout: 5000,
    maxBuffer: 4096,
    encoding: 'utf8',
  });
  assert.equal(output, 'long-prefix classifier checks passed');
});
