#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');

const ADMIN_URL = 'postgresql://oct8_fixture:oct8_fixture_only@127.0.0.1:55438/autexa_oct8_test';
const APP_PASSWORD = 'oct8_app_fixture_only';
const backendRoot = path.resolve(__dirname, '../backend');

function assertFixtureEnvironment() {
  if (process.env.DATABASE_URL !== ADMIN_URL || process.env.DB_APP_PASSWORD !== APP_PASSWORD) {
    throw new Error('Refusing migration: CI fixture URL and app-role password are required');
  }
  const url = new URL(process.env.DATABASE_URL);
  if (
    url.hostname !== '127.0.0.1' ||
    url.port !== '55438' ||
    url.pathname !== '/autexa_oct8_test' ||
    url.username !== 'oct8_fixture' ||
    url.password !== 'oct8_fixture_only'
  ) {
    throw new Error('Refusing migration: target is not the disposable October-8 fixture');
  }
}

async function main() {
  assertFixtureEnvironment();
  const backendRequire = createRequire(path.join(backendRoot, 'package.json'));
  const { Client } = backendRequire('pg');
  const client = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT current_database() AS database, current_user AS role,
             current_setting('server_version_num')::int AS version_num,
             (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_superuser
    `);
    const info = rows[0];
    if (
      info.database !== 'autexa_oct8_test' ||
      info.role !== 'oct8_fixture' ||
      info.version_num < 160000 ||
      info.version_num >= 170000 ||
      info.is_superuser !== true
    ) {
      throw new Error('Refusing migration: connected PostgreSQL fixture identity/version did not match');
    }
  } finally {
    await client.end();
  }

  process.chdir(backendRoot);
  const { MigrationRunner } = require(path.join(backendRoot, 'dist/migration-runner'));
  await new MigrationRunner().onModuleInit();

  const verify = new Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 5000 });
  await verify.connect();
  try {
    const applied = new Set((await verify.query('SELECT name FROM _migrations')).rows.map((row) => row.name));
    const migrations = require('node:fs')
      .readdirSync(path.join(backendRoot, 'migrations'))
      .filter((name) => name.endsWith('.sql'));
    if (migrations.some((name) => !applied.has(name))) {
      throw new Error('MigrationRunner did not apply every repository migration');
    }
    const role = (
      await verify.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'autexa_app'")
    ).rows[0];
    if (!role || role.rolsuper !== false || role.rolbypassrls !== false) {
      throw new Error('MigrationRunner did not provision the restricted autexa_app role');
    }
    console.log(`Verified disposable PostgreSQL 16 fixture; ${migrations.length} migrations applied; app role has RLS.`);
  } finally {
    await verify.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
