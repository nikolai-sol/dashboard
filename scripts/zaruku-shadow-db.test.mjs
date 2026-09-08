import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { loadMysqlTableAuthority } from './zaruku-production-shadow-contract.mjs';
import {
  applyReaderBoundary,
  buildReaderSql,
  verifyReaderBoundary,
} from './zaruku-shadow-db.mjs';

const root = path.resolve(import.meta.dirname, '..');
const authority = loadMysqlTableAuthority(path.join(root, 'deploy/zaruku/mysql-read-tables.json'));
const account = 'dashboard_zaruku_reader@127.0.0.1';
const accountRow = { user: 'dashboard_zaruku_reader', host: '127.0.0.1' };
const accessDenied = () => Object.assign(new Error('fixture access denied'), {
  code: 'ER_TABLEACCESS_DENIED_ERROR',
  errno: 1142,
});

function expectedTableRows(overrides = {}) {
  return authority.tables.map(tableName => ({
    tableSchema: 'report_bd',
    tableName,
    privilegeType: 'SELECT',
    ...overrides[tableName],
  }));
}

function expectedObjectRows(overrides = {}) {
  return authority.tables.map(tableName => ({
    tableName,
    tableType: 'BASE TABLE',
    ...overrides[tableName],
  }));
}

function grantRows(extra = []) {
  return [
    { grant: "GRANT USAGE ON *.* TO 'dashboard_zaruku_reader'@'127.0.0.1'" },
    ...authority.tables.map(tableName => ({
      grant: `GRANT SELECT ON \`report_bd\`.\`${tableName}\` TO 'dashboard_zaruku_reader'@'127.0.0.1'`,
    })),
    ...extra.map(grant => ({ grant })),
  ];
}

function boundaryFixture(options = {}) {
  const secret = options.secret ?? 'fixture-secret-marker';
  const calls = [];
  let created = false;
  const context = options.context ?? {
    platform: 'linux',
    effectiveUid: 0,
    protocol: 'socket',
    currentUser: 'root@localhost',
  };
  const accountRows = options.accountRows;

  const reader = {
    async query(sql) {
      calls.push({ actor: 'reader', sql });
      if (/^START TRANSACTION$/i.test(sql) || /^ROLLBACK$/i.test(sql)) return [];
      if (/^UPDATE\s+/i.test(sql)) {
        if (options.writeSucceeds) return { affectedRows: 0 };
        throw accessDenied();
      }
      if (/report_bd_private/i.test(sql)) {
        if (options.privateReadSucceeds) return [{ rowCount: 0 }];
        throw accessDenied();
      }
      if (/canonical_fact_ads_daily/i.test(sql)) {
        if (options.advertisingReadSucceeds) return [{ rowCount: 0 }];
        throw accessDenied();
      }
      if (/^SELECT COUNT\(\*\) AS rowCount FROM `report_bd`\.`/i.test(sql)) {
        return [{ rowCount: 0 }];
      }
      throw new Error(`Unexpected reader SQL: ${sql}`);
    },
    async close() {
      calls.push({ actor: 'reader', close: true });
    },
  };

  const admin = {
    async context() {
      calls.push({ actor: 'admin', context: true });
      return context;
    },
    async openReader(password) {
      calls.push({ actor: 'admin', openReader: password === secret ? '<credential>' : '<invalid-credential>' });
      return reader;
    },
    async query(sql, params = []) {
      calls.push({
        actor: 'admin',
        sql,
        params: params.map(value => value === secret ? '<credential>' : String(value)),
      });
      if (/^CREATE USER /i.test(sql)) {
        created = true;
        if (options.createError) throw options.createError;
        return { affectedRows: 0 };
      }
      if (/^GRANT SELECT /i.test(sql)) {
        if (options.grantError) throw options.grantError;
        return { affectedRows: 0 };
      }
      if (/^DROP USER IF EXISTS /i.test(sql)) {
        created = false;
        if (options.dropError) throw options.dropError;
        return { affectedRows: 0 };
      }
      if (/FROM mysql\.user/i.test(sql)) {
        if (accountRows) return accountRows;
        return created || options.verifyExisting ? [accountRow] : [];
      }
      if (/FROM information_schema\.USER_PRIVILEGES/i.test(sql)) {
        if (options.globalRows) return options.globalRows;
        return /PRIVILEGE_TYPE\s*<>\s*'USAGE'/i.test(sql) ? [] : [{ privilegeType: 'USAGE' }];
      }
      if (/FROM information_schema\.SCHEMA_PRIVILEGES/i.test(sql)) {
        return options.schemaRows ?? [];
      }
      if (/FROM information_schema\.TABLE_PRIVILEGES/i.test(sql)) {
        return options.tableRows ?? expectedTableRows();
      }
      if (/FROM information_schema\.TABLES/i.test(sql)) {
        return options.objectRows ?? expectedObjectRows();
      }
      if (/^SHOW GRANTS FOR /i.test(sql)) {
        return options.grants ?? grantRows();
      }
      throw new Error(`Unexpected admin SQL: ${sql}`);
    },
  };

  return { admin, reader, calls, secret };
}

function withPasswordFd(secret, callback) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zaruku-reader-password-'));
  const filename = path.join(directory, 'password');
  fs.writeFileSync(filename, secret, { mode: 0o600 });
  const fd = fs.openSync(filename, 'r');
  return Promise.resolve()
    .then(() => callback(fd))
    .finally(() => {
      fs.closeSync(fd);
      fs.rmSync(directory, { recursive: true });
    });
}

test('reader SQL grants table-level SELECT only', () => {
  const operations = buildReaderSql(authority, 'fixture-secret');
  assert.equal(operations.length, authority.tables.length + 1);
  assert.ok(operations.every(op => !/INSERT|UPDATE|DELETE|CREATE VIEW|GRANT OPTION/i.test(op.sql)));
  assert.ok(operations.every(op => !/ON\s+(?:`report_bd`\.)?\*/i.test(op.sql)));
  assert.ok(operations.some(op => op.sql === 'GRANT SELECT ON `report_bd`.`dashboards` TO ?'));
  assert.equal(operations[0].sql, "CREATE USER 'dashboard_zaruku_reader'@'127.0.0.1' IDENTIFIED BY ?");
  assert.equal(operations.filter(op => /^CREATE USER /i.test(op.sql)).length, 1);
  assert.equal(operations.filter(op => /^GRANT SELECT /i.test(op.sql)).length, authority.tables.length);
});

test('reader SQL rejects an unknown authority input key without exposing the password', () => {
  const marker = 'unknown-key-secret-marker';
  assert.throws(
    () => buildReaderSql({ ...authority, password: marker }, marker),
    error => /authority|input|key/i.test(error.message) && !error.message.includes(marker),
  );
});

test('verification accepts the exact physical-table SELECT boundary and returns aggregate evidence only', async () => {
  const fixture = boundaryFixture({ verifyExisting: true });
  const evidence = await verifyReaderBoundary(fixture.admin, fixture.reader);
  assert.deepEqual(evidence, {
    account,
    globalPrivileges: [],
    schemaPrivileges: [],
    tableSelectCount: authority.tables.length,
    unexpectedPrivileges: [],
    canSelectAllowedFamilies: true,
    canWriteCanonicalFacts: false,
    canReadPrivateSchema: false,
    canReadAdvertisingOnlyFact: false,
  });
  assert.doesNotMatch(JSON.stringify(evidence), /rowCount|fixture-secret-marker/);
});

test('verification fails closed for a missing grant table or a view substitution', async () => {
  const missing = boundaryFixture({
    verifyExisting: true,
    tableRows: expectedTableRows().slice(1),
  });
  await assert.rejects(() => verifyReaderBoundary(missing.admin, missing.reader), /boundary|table|privilege/i);

  const absentPhysicalTable = boundaryFixture({
    verifyExisting: true,
    objectRows: expectedObjectRows().slice(1),
  });
  await assert.rejects(() => verifyReaderBoundary(absentPhysicalTable.admin, absentPhysicalTable.reader), /boundary|table|physical/i);

  const view = boundaryFixture({
    verifyExisting: true,
    objectRows: expectedObjectRows({ dashboards: { tableType: 'VIEW' } }),
  });
  await assert.rejects(() => verifyReaderBoundary(view.admin, view.reader), /boundary|table|view|physical/i);
});

test('verification rejects wildcard, global, and schema privileges', async () => {
  const wildcard = boundaryFixture({
    verifyExisting: true,
    grants: grantRows(["GRANT SELECT ON `report_bd`.* TO 'dashboard_zaruku_reader'@'127.0.0.1'"]),
  });
  await assert.rejects(() => verifyReaderBoundary(wildcard.admin, wildcard.reader), /boundary|wildcard|privilege/i);

  const global = boundaryFixture({
    verifyExisting: true,
    globalRows: [{ privilegeType: 'SELECT' }],
  });
  await assert.rejects(() => verifyReaderBoundary(global.admin, global.reader), /boundary|global|privilege/i);

  const schema = boundaryFixture({
    verifyExisting: true,
    schemaRows: [{ tableSchema: 'report_bd', privilegeType: 'SELECT' }],
  });
  await assert.rejects(() => verifyReaderBoundary(schema.admin, schema.reader), /boundary|schema|privilege/i);
});

test('verification requires denied writes, private-schema reads, and advertising-only reads', async () => {
  for (const options of [
    { writeSucceeds: true },
    { privateReadSucceeds: true },
    { advertisingReadSucceeds: true },
  ]) {
    const fixture = boundaryFixture({ verifyExisting: true, ...options });
    await assert.rejects(() => verifyReaderBoundary(fixture.admin, fixture.reader), /boundary|denied|write|private|advertising/i);
  }
});

test('apply refuses any existing username account before consuming the password descriptor', async () => {
  const fixture = boundaryFixture({
    accountRows: [{ user: 'dashboard_zaruku_reader', host: '%' }],
  });
  await withPasswordFd(fixture.secret, async fd => {
    await assert.rejects(() => applyReaderBoundary(fixture.admin, fd), /existing|account|boundary/i);
  });
  assert.ok(!fixture.calls.some(call => call.openReader));
  assert.ok(!fixture.calls.some(call => /^CREATE USER /i.test(call.sql ?? '')));
  assert.ok(!fixture.calls.some(call => /^DROP USER /i.test(call.sql ?? '')));
});

test('apply creates, grants, verifies, and records no supplied password', async () => {
  const fixture = boundaryFixture();
  const evidence = await withPasswordFd(fixture.secret, fd => applyReaderBoundary(fixture.admin, fd));
  assert.equal(evidence.tableSelectCount, authority.tables.length);
  assert.equal(fixture.calls.filter(call => /^GRANT SELECT /i.test(call.sql ?? '')).length, authority.tables.length);
  assert.doesNotMatch(JSON.stringify(evidence), new RegExp(fixture.secret));
  assert.doesNotMatch(JSON.stringify(fixture.calls), new RegExp(fixture.secret));
});

test('apply rolls back only the fixed account and sanitizes statement and cleanup errors', async () => {
  const marker = 'apply-error-secret-marker';
  const fixture = boundaryFixture({
    secret: marker,
    grantError: new Error(`grant failed for ${marker}`),
    dropError: new Error(`drop failed for ${marker}`),
  });
  await withPasswordFd(marker, async fd => {
    await assert.rejects(
      () => applyReaderBoundary(fixture.admin, fd),
      error => /boundary|apply/i.test(error.message) && !error.message.includes(marker),
    );
  });
  const drops = fixture.calls.filter(call => /^DROP USER /i.test(call.sql ?? ''));
  assert.equal(drops.length, 1);
  assert.equal(drops[0].sql, "DROP USER IF EXISTS 'dashboard_zaruku_reader'@'127.0.0.1'");
  assert.doesNotMatch(JSON.stringify(fixture.calls), new RegExp(marker));
});

test('apply drops the fixed account when post-grant verification fails', async () => {
  const fixture = boundaryFixture({ objectRows: expectedObjectRows().slice(1) });
  await withPasswordFd(fixture.secret, async fd => {
    await assert.rejects(() => applyReaderBoundary(fixture.admin, fd), /boundary|apply/i);
  });
  const drops = fixture.calls.filter(call => /^DROP USER /i.test(call.sql ?? ''));
  assert.deepEqual(drops.map(drop => drop.sql), [
    "DROP USER IF EXISTS 'dashboard_zaruku_reader'@'127.0.0.1'",
  ]);
});

test('apply rejects non-root, non-socket, non-production-admin, and unknown context input', async () => {
  for (const context of [
    { platform: 'darwin', effectiveUid: 0, protocol: 'socket', currentUser: 'root@localhost' },
    { platform: 'linux', effectiveUid: 1000, protocol: 'socket', currentUser: 'root@localhost' },
    { platform: 'linux', effectiveUid: 0, protocol: 'tcp', currentUser: 'root@localhost' },
    { platform: 'linux', effectiveUid: 0, protocol: 'socket', currentUser: 'report_bd@localhost' },
    { platform: 'linux', effectiveUid: 0, protocol: 'socket', currentUser: 'root@localhost', unexpected: true },
  ]) {
    const fixture = boundaryFixture({ context });
    await withPasswordFd(fixture.secret, async fd => {
      await assert.rejects(() => applyReaderBoundary(fixture.admin, fd), /boundary|context|root|socket|admin/i);
    });
    assert.ok(!fixture.calls.some(call => /^CREATE USER /i.test(call.sql ?? '')));
  }
});
