const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, PassThrough } = require('node:stream');
const { invoiceUpload } = require('../dist/supplier-invoices/supplier-invoices.controller');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6kSAAAAAASUVORK5CYII=',
  'base64',
);

async function encoded(form) {
  const request = new Request('http://localhost/only-test', { method: 'POST', body: form });
  const bytes = Buffer.from(await request.arrayBuffer());
  return { bytes, headers: Object.fromEntries(request.headers) };
}
async function upload(form) {
  const { bytes, headers } = await encoded(form);
  const req = Readable.from([bytes]);
  req.headers = headers;
  return invoiceUpload(req);
}
const status400 = (error) => error.getStatus?.() === 400;

test('actual Node FormData multipart single PNG is accepted byte-for-byte', async () => {
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'single.png');
  assert.deepEqual(await upload(form), png);
});
test('actual multipart empty form, two files and an extra text field are rejected', async () => {
  await assert.rejects(upload(new FormData()), status400);
  const two = new FormData();
  two.append('file', new Blob([png]), 'one.png');
  two.append('file', new Blob([png]), 'two.png');
  await assert.rejects(upload(two), status400);
  const text = new FormData();
  text.append('file', new Blob([png]), 'one.png');
  text.append('extra', 'must not be accepted');
  await assert.rejects(upload(text), status400);
});
test('actual multipart byte limit accepts exactly10MiB and rejects10MiB+1', async () => {
  const maximum = 10 * 1024 * 1024;
  const exact = new FormData();
  exact.append('file', new Blob([Buffer.alloc(maximum)]), 'exact.png');
  assert.equal((await upload(exact)).length, maximum);
  const large = new FormData();
  large.append('file', new Blob([Buffer.alloc(maximum + 1)]), 'large.png');
  await assert.rejects(upload(large), status400);
});
test('aborted multipart stream rejects promptly and releases parser listeners', async () => {
  const form = new FormData();
  form.append('file', new Blob([png]), 'aborted.png');
  const { bytes, headers } = await encoded(form);
  const req = new PassThrough();
  req.headers = headers;
  const pending = invoiceUpload(req);
  req.write(bytes.subarray(0, Math.floor(bytes.length / 2)));
  req.emit('aborted');
  req.emit('error', new Error('synthetic transport reset after abort'));
  req.end();
  await assert.rejects(pending, status400);
  assert.equal(req.listenerCount('aborted'), 0);
});
