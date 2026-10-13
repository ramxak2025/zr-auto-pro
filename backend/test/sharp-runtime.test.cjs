const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, readdirSync, rmSync, statSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const sharp = require('sharp');
const { PKPass } = require('passkit-generator');
const { LocalStorageAdapter } = require('../dist/uploads/storage.service');
const { EmployeesService } = require('../dist/employees/employees.service');
const { buildLoyaltyPass } = require('../dist/wallet/pass-builder');

// Exercise the compiled CommonJS modules and real native image operations.
// A TS typecheck alone permits a synthetic default export that sharp does not have.
test('compiled backend sharp consumers process real images', async (t) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'autexa-sharp-runtime-'));
  const previousUploadDir = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = directory;
  const tenant = randomUUID();
  const png = await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#234567' } })
    .png()
    .toBuffer();
  try {
    await t.test('uploads produce bounded WebP and JPEG instead of silently retaining the original', async () => {
      const storage = new LocalStorageAdapter(),
        warnings = [];
      storage.logger = { log() {}, warn: (message) => warnings.push(message) };
      const saved = await storage.save(Readable.from(png), '.png', tenant);
      assert.equal(path.extname(saved.storedPath), '.webp', warnings.join('\n'));
      assert.deepEqual(warnings, []);
      assert.equal(saved.size, statSync(path.join(directory, saved.storedPath)).size);
      for (const [url, format] of [
        [saved.url, 'webp'],
        [saved.thumbnailUrl, 'jpeg'],
      ]) {
        const metadata = await sharp(path.join(directory, url.slice('/api/uploads/'.length))).metadata();
        assert.equal(metadata.format, format);
        assert.equal(metadata.width, 1200);
        assert.equal(metadata.height, 600);
      }
      assert.equal(
        readdirSync(path.join(directory, tenant)).some((name) => name.includes('.tmp')),
        false,
      );
    });

    await t.test('employee photo writes a 512px WebP and persists the tenant-scoped URL', async () => {
      const employee = randomUUID(),
        writes = [];
      const employees = new EmployeesService({
        query: async (sql, values) => {
          writes.push({ sql, values });
          return { rows: [], rowCount: 1 };
        },
      });
      const saved = await employees.uploadPhoto(
        { userID: employee, role: 'master', permissions: {} },
        tenant,
        employee,
        Readable.from(png),
        '.png',
      );
      assert.ok(saved.photoUrl.startsWith(`/api/uploads/${tenant}/employees/`));
      const metadata = await sharp(path.join(directory, saved.photoUrl.slice('/api/uploads/'.length))).metadata();
      assert.equal(metadata.format, 'webp');
      assert.equal(metadata.width, 512);
      assert.equal(metadata.height, 512);
      assert.equal(writes.length, 1);
      assert.match(writes[0].sql, /WHERE id=\$2 AND tenant_id=\$3/);
      assert.deepEqual(writes[0].values, [saved.photoUrl, employee, tenant]);
      assert.equal(
        readdirSync(path.join(directory, tenant, 'employees')).some((name) => name.includes('.tmp')),
        false,
      );
    });

    await t.test('Wallet creates all actual PNG assets before the signing boundary', async (t) => {
      const images = new Map(),
        addBuffer = PKPass.prototype.addBuffer;
      t.mock.method(PKPass.prototype, 'addBuffer', function (name, bytes) {
        images.set(name, bytes);
        return addBuffer.call(this, name, bytes);
      });
      // Signing is unrelated to import interop and needs private certificates.
      // Keep the real pass builder/constructor and all five sharp encodes.
      const signed = Buffer.from('fixture-signing-boundary');
      t.mock.method(PKPass.prototype, 'getAsBuffer', () => signed);
      const result = await buildLoyaltyPass({
        passTypeId: 'pass.example.fixture',
        teamId: 'FIXTURE1234',
        certPem: 'fixture',
        certKeyPem: 'fixture',
        wwdrPem: 'fixture',
        organizationName: 'Fixture',
        shopName: 'Fixture',
        clientId: randomUUID(),
        clientName: 'Fixture',
        balance: 100.25,
      });
      assert.equal(result, signed);
      const expected = {
        'icon.png': [29, 29],
        'icon@2x.png': [58, 58],
        'icon@3x.png': [87, 87],
        'logo.png': [160, 50],
        'logo@2x.png': [320, 100],
      };
      assert.deepEqual([...images.keys()].sort(), Object.keys(expected).sort());
      for (const [name, dimensions] of Object.entries(expected)) {
        const metadata = await sharp(images.get(name)).metadata();
        assert.equal(metadata.format, 'png');
        assert.deepEqual([metadata.width, metadata.height], dimensions);
      }
    });
  } finally {
    if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previousUploadDir;
    rmSync(directory, { recursive: true, force: true });
  }
});
