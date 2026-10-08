const assert = require('node:assert/strict');
const test = require('node:test');
const { BadRequestException, ForbiddenException } = require('@nestjs/common');
require('reflect-metadata');
const { ValidationPipe } = require('@nestjs/common');
const { CreateCheckTemplateFolderDto, UpdateCheckTemplateFolderDto, UpdateCheckTemplateDto } = require('../dist/check-templates/dto/check-template.dto.js');
const { CheckTemplatesService } = require('../dist/check-templates/check-templates.service.js');

function makeTreePool({ mixedFolder = false, parentMode = 'root' } = {}) {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql) || /pg_advisory_xact_lock/.test(sql)) return { rows: [] };
    if (/SELECT id FROM subtree WHERE id=\$3/.test(sql)) {
      return { rows: parentMode === 'cycle' ? [{ id: params[2] }] : [] };
    }
    if (/WITH RECURSIVE subtree/.test(sql) && /SELECT id FROM subtree/.test(sql)) return { rows: [{ id: 'root' }, { id: 'child' }] };
    if (/FROM check_template_folders[\s\S]*IS DISTINCT FROM/.test(sql)) return { rows: mixedFolder ? [{ id: 'foreign-child' }] : [] };
    if (/FROM check_templates[\s\S]*IS DISTINCT FROM/.test(sql)) return { rows: [] };
    if (/SELECT id FROM check_template_folders/.test(sql) && /WHERE id=\$1 AND tenant_id=\$2 AND user_id IS NOT DISTINCT FROM/.test(sql)) {
      return { rows: parentMode === 'foreign' ? [] : [{ id: params[0] }] };
    }
    if (/SELECT user_id FROM check_template_folders/.test(sql)) return { rows: [{ user_id: 'owner-1' }] };
    if (/SELECT id, name, parent_id, sort, created_at, user_id FROM check_template_folders/.test(sql)) {
      return { rows: [{ id: 'root', name: 'Моё дерево', parent_id: 'private-parent', sort: 2, user_id: 'owner-1' }] };
    }
    if (/UPDATE check_template_folders SET user_id=NULL/.test(sql) || /UPDATE check_templates SET user_id=NULL/.test(sql)) return { rows: [] };
    if (/UPDATE check_template_folders SET name=/.test(sql)) {
      return { rows: [{ id: 'root', name: params[0], parent_id: params[1], sort: params[2], user_id: params[3], created_at: 'now' }] };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  return { calls, connect: async () => ({ query, release() {} }) };
}

const manager = { userID: 'owner-1', role: 'admin', permissions: { templates_shared_manage: true } };

test('publishing private folder publishes its nested tree in place, detaches root, and retains IDs', async () => {
  const pool = makeTreePool();
  const result = await new CheckTemplatesService(pool).updateFolder('root', 'tenant-1', manager, { isShared: true });
  assert.equal(result.id, 'root');
  assert.equal(result.isShared, true);
  const folderPublish = pool.calls.find((call) => /UPDATE check_template_folders SET user_id=NULL/.test(call.sql));
  const templatePublish = pool.calls.find((call) => /UPDATE check_templates SET user_id=NULL/.test(call.sql));
  assert.deepEqual(folderPublish.params[1], ['root', 'child']);
  assert.deepEqual(templatePublish.params[1], ['root', 'child']);
  assert.equal(pool.calls.some((call) => /INSERT INTO check_template_(folders|templates)/.test(call.sql)), false);
  assert.ok(pool.calls.some((call) => /pg_advisory_xact_lock/.test(call.sql)));
});

test('publishing rejects a mixed-scope subtree before moving any row', async () => {
  const pool = makeTreePool({ mixedFolder: true });
  await assert.rejects(
    new CheckTemplatesService(pool).updateFolder('root', 'tenant-1', manager, { isShared: true }),
    (err) => err instanceof BadRequestException && err.getStatus() === 400,
  );
  assert.equal(pool.calls.some((call) => /UPDATE check_template_(folders|templates) SET user_id=NULL/.test(call.sql)), false);
});

test('private folder cannot move under another employee folder or its own descendant', async () => {
  for (const parentMode of ['foreign', 'cycle']) {
    const pool = makeTreePool({ parentMode });
    await assert.rejects(
      new CheckTemplatesService(pool).updateFolder('root', 'tenant-1', manager, { parentId: 'other-folder' }),
      (err) => err instanceof BadRequestException && err.getStatus() === 400,
    );
    assert.equal(pool.calls.some((call) => /UPDATE check_template_folders SET name=/.test(call.sql)), false);
  }
});

test('permission holder is required to create a shared folder', async () => {
  const pool = makeTreePool();
  await assert.rejects(
    new CheckTemplatesService(pool).createFolder('tenant-1', { userID: 'master-1', role: 'master' }, { name: 'Общее', isShared: true }),
    (err) => err instanceof ForbiddenException && err.getStatus() === 403,
  );
  assert.equal(pool.calls.some((call) => /INSERT INTO check_template_folders/.test(call.sql)), false);
});

test('folder rename rejects a null name with a validation error before writing', async () => {
  const pool = makeTreePool();
  await assert.rejects(
    new CheckTemplatesService(pool).updateFolder('root', 'tenant-1', manager, { name: null }),
    (err) => err instanceof BadRequestException && err.getStatus() === 400,
  );
  assert.equal(pool.calls.some((call) => /UPDATE check_template_folders SET name=/.test(call.sql)), false);
});

test('folder publish and template publish fields survive the real whitelist DTO boundary', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  const body = (value, metatype) => pipe.transform(value, { type: 'body', metatype });
  const createdFolder = await body({ name: 'Команда', isShared: true, parentId: null }, CreateCheckTemplateFolderDto);
  const updatedFolder = await body({ isShared: true }, UpdateCheckTemplateFolderDto);
  const publishedTemplate = await body({ shared: true, folderId: '00000000-0000-0000-0000-000000000001' }, UpdateCheckTemplateDto);
  assert.equal(createdFolder.isShared, true);
  assert.equal(createdFolder.parentId, null);
  assert.equal(updatedFolder.isShared, true);
  assert.equal(publishedTemplate.shared, true);
});
