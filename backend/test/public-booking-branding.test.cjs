const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {
  encodeBookingBranding,
  readBookingBranding,
  validateBookingBrandingUrl,
  PublicBookingBrandingStorage,
  BOOKING_BRANDING_MAX_BYTES,
} = require('../dist/bookings/public-booking-branding');
const bad = (e) => e.getStatus?.() === 400;
const image = () => sharp({ create: { width: 48, height: 40, channels: 4, background: '#2a60df' } });
function multipart(body) {
  const request = Readable.from(body);
  request.headers = { 'content-type': 'multipart/form-data; boundary=branding' };
  return request;
}
test('branding verifies bytes rather than extension and strips metadata; decoder failures never return original', async () => {
  for (const format of ['jpeg', 'png', 'webp']) {
    const original = await image().withMetadata({ orientation: 6 }).toFormat(format).toBuffer();
    const encoded = await encodeBookingBranding(original);
    const metadata = await sharp(encoded).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.orientation, undefined);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.ok(metadata.width <= 1800 && metadata.height <= 1200);
  }
  for (const bytes of [
    Buffer.from('<svg><script>alert(1)</script></svg>'),
    Buffer.from('<html>image.jpg</html>'),
    Buffer.from([0xff, 0xd8, 0xff, 0, 0]),
    Buffer.alloc(BOOKING_BRANDING_MAX_BYTES + 1),
    await sharp({ create: { width: 5001, height: 5000, channels: 3, background: '#fff' } })
      .png()
      .toBuffer(),
  ]) {
    await assert.rejects(encodeBookingBranding(bytes), bad);
  }
});
test('multipart waits for completion, rejects extra parts, wrong field and oversized streams', async () => {
  const png = await image().png().toBuffer();
  const part = (field) =>
    Buffer.concat([
      Buffer.from(
        `--branding\r\nContent-Disposition: form-data; name="${field}"; filename="spoof.txt"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      png,
      Buffer.from('\r\n'),
    ]);
  assert.deepEqual(
    await readBookingBranding(multipart(Buffer.concat([part('file'), Buffer.from('--branding--\r\n')]))),
    png,
  );
  await assert.rejects(
    readBookingBranding(multipart(Buffer.concat([part('file'), part('file'), Buffer.from('--branding--\r\n')]))),
    bad,
  );
  await assert.rejects(
    readBookingBranding(multipart(Buffer.concat([part('other'), Buffer.from('--branding--\r\n')]))),
    bad,
  );
  const huge = Buffer.concat([
    Buffer.from('--branding\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\n\r\n'),
    Buffer.alloc(BOOKING_BRANDING_MAX_BYTES + 1),
    Buffer.from('\r\n--branding--\r\n'),
  ]);
  await assert.rejects(readBookingBranding(multipart(huge)), bad);
});
test('server-owned stored URLs are exact, existing and bound to tenant and branch', async () => {
  const previous = process.env.UPLOAD_DIR;
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'booking-branding-'));
  process.env.UPLOAD_DIR = temporary;
  try {
    const tenant = randomUUID(),
      point = randomUUID();
    const storage = new PublicBookingBrandingStorage();
    const uploaded = await storage.save(await image().png().toBuffer(), tenant, point);
    assert.equal(validateBookingBrandingUrl(uploaded.url, tenant, point), uploaded.url);
    assert.equal(validateBookingBrandingUrl(null, tenant, point), null);
    assert.equal(validateBookingBrandingUrl(undefined, tenant, point), undefined);
    for (const value of [
      'https://example.test/logo.webp',
      'data:image/png;base64,AAAA',
      'blob:logo',
      '/api/uploads/private/passport.webp',
      uploaded.url + '?x=1',
      uploaded.url.replace('/public-booking-branding/', '/public-booking-branding/../'),
      uploaded.url.replace(point, randomUUID()),
      uploaded.url.replace(tenant, randomUUID()),
      uploaded.url.replace(/[^/]+$/, `${randomUUID()}.webp`),
    ])
      assert.throws(() => validateBookingBrandingUrl(value, tenant, point), bad);
    assert.throws(() => validateBookingBrandingUrl(uploaded.url, tenant, null), bad);
    await assert.rejects(storage.save(Buffer.from('not image'), tenant, point), bad);
    assert.equal(fs.readdirSync(path.join(temporary, 'public-booking-branding', tenant, point)).length, 1);
  } finally {
    if (previous === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
