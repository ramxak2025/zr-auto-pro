const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    }).outputText,
    filename,
  );
const {
  formatBookingPhone,
  normalizeBookingPhone,
  editBookingPhone,
  formatBookingPhoneInput,
} = require('../src/utils/bookingPhone');
test('booking mask accepts Russian paste variants and sends one normalized country code', () => {
  for (const raw of ['9884444436', '89884444436', '79884444436', '+7 (988) 444-44-36']) {
    assert.equal(formatBookingPhone(raw), '+7 (988) 444-44-36');
    assert.equal(normalizeBookingPhone(formatBookingPhone(raw)), '+79884444436');
    assert.deepEqual(editBookingPhone('', 0, 0, raw), { value: '+7 (988) 444-44-36', caret: 18 });
  }
});
test('sequential digits and partial country prefix remain editable but cannot submit', () => {
  let value = '';
  for (const digit of '9884444436') value = formatBookingPhoneInput(value + digit, value.length + 1).value;
  assert.equal(value, '+7 (988) 444-44-36');
  for (const raw of ['', '7', '8', '+7', '9', '+7 (988)', '+7 (988) 444-44-3'])
    assert.equal(normalizeBookingPhone(raw), null);
});
test('deletion across mask separators removes a digit; middle edits and selected replacement retain logical caret', () => {
  const value = '+7 (988) 444-44-36';
  const deleted = editBookingPhone(value, 9, 9, '', 'backspace');
  assert.equal(deleted.value, '+7 (984) 444-43-6');
  assert.equal(deleted.caret, 6);
  const forward = editBookingPhone(value, 7, 7, '', 'delete');
  assert.equal(forward.value, '+7 (988) 444-43-6');
  assert.equal(forward.caret, 7);
  const selected = editBookingPhone(value, 9, 12, '555');
  assert.equal(selected.value, '+7 (988) 555-44-36');
  assert.equal(selected.caret, 12);
  assert.deepEqual(editBookingPhone(value, 0, value.length, '', 'backspace'), { value: '', caret: 0 });
});
