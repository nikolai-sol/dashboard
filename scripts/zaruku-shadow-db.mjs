import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { loadMysqlTableAuthority } from './zaruku-production-shadow-authority.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const AUTHORITY_PATH = path.join(ROOT, 'deploy/zaruku/mysql-read-tables.json');
const AUTHORITY = loadMysqlTableAuthority(AUTHORITY_PATH);
const ACCOUNT = 'dashboard_zaruku_reader@127.0.0.1';
const ACCOUNT_USER = 'dashboard_zaruku_reader';
const ACCOUNT_HOST = '127.0.0.1';
const ACCOUNT_SQL = "'dashboard_zaruku_reader'@'127.0.0.1'";
const CREATION_LOCK = 'reportingdash:zaruku-reader-boundary:v1';
const CREATION_LOCK_TIMEOUT_SECONDS = 30;
const AUTHORITY_KEYS = Object.freeze(['account', 'database', 'scope', 'tables']);
const CONTEXT_KEYS = Object.freeze(['currentUser', 'effectiveUid', 'platform', 'protocol']);
const ACCESS_DENIED_CODES = new Set([
  'ER_ACCESS_DENIED_ERROR',
  'ER_DBACCESS_DENIED_ERROR',
  'ER_TABLEACCESS_DENIED_ERROR',
]);
const ACCESS_DENIED_ERRNOS = new Set([1044, 1045, 1142]);

function invalidBoundary() {
  throw new Error('Invalid Zaruku MySQL reader boundary');
}

function invalidAuthority() {
  throw new Error('Invalid Zaruku MySQL reader authority');
}

function exactKeys(value, expected) {
  return value !== null && !Array.isArray(value) && typeof value === 'object' &&
    isDeepStrictEqual(Object.keys(value).sort(), [...expected].sort());
}

function assertAuthority(authority) {
  if (!exactKeys(authority, AUTHORITY_KEYS) || authority.scope !== AUTHORITY.scope ||
      authority.account !== ACCOUNT || authority.database !== AUTHORITY.database ||
      !isDeepStrictEqual(authority.tables, AUTHORITY.tables)) invalidAuthority();
}

function assertAdapter(adapter, methods) {
  if (!adapter || methods.some(method => typeof adapter[method] !== 'function')) invalidBoundary();
}

function accountParameter() {
  return Object.freeze({
    toSqlString() { return ACCOUNT_SQL; },
  });
}

function freezeOperations(operations) {
  for (const operation of operations) {
    Object.freeze(operation.params);
    Object.freeze(operation);
  }
  return Object.freeze(operations);
}

/**
 * @typedef {{sql: string, params: readonly unknown[]}} SqlOperation
 */

/**
 * Build the sole authorized first-creation SQL plan for the fixed Zaruku reader.
 * @param {Readonly<{scope: string, account: string, database: string, tables: readonly string[]}>} authority
 * @param {string} password
 * @returns {readonly SqlOperation[]}
 */
export function buildReaderSql(authority, password) {
  assertAuthority(authority);
  if (typeof password !== 'string' || password.length === 0 || password.length > 4096 || /[\r\n\0]/.test(password)) invalidBoundary();
  return freezeOperations([
    { sql: `CREATE USER ${ACCOUNT_SQL} IDENTIFIED BY ?`, params: [password] },
    ...authority.tables.map(table => ({
      sql: `GRANT SELECT ON \`${authority.database}\`.\`${table}\` TO ?`,
      params: [accountParameter()],
    })),
  ]);
}

function assertRows(rows, keys) {
  if (!Array.isArray(rows) || rows.some(row => !exactKeys(row, keys))) invalidBoundary();
  return rows;
}

function isAccessDenied(error) {
  return ACCESS_DENIED_CODES.has(error?.code) || ACCESS_DENIED_ERRNOS.has(error?.errno);
}

function rowCountIsNonnegative(rows) {
  if (!Array.isArray(rows) || rows.length !== 1 || !exactKeys(rows[0], ['rowCount'])) return false;
  const value = rows[0].rowCount;
  return (typeof value === 'number' && Number.isFinite(value) && value >= 0) ||
    (typeof value === 'bigint' && value >= 0n) ||
    (typeof value === 'string' && /^\d+$/.test(value));
}

async function expectDenied(adapter, sql) {
  try {
    await adapter.query(sql);
  } catch (error) {
    if (isAccessDenied(error)) return false;
    throw error;
  }
  invalidBoundary();
}

async function expectWriteDenied(readerAdapter) {
  await readerAdapter.query('START TRANSACTION');
  let denied = false;
  let probeError;
  try {
    await readerAdapter.query(
      'UPDATE `report_bd`.`canonical_fact_site_analytics_daily` SET `visits` = `visits` WHERE 1 = 0',
    );
  } catch (error) {
    if (isAccessDenied(error)) denied = true;
    else probeError = error;
  }
  try {
    await readerAdapter.query('ROLLBACK');
  } catch (error) {
    probeError ??= error;
  }
  if (probeError) throw probeError;
  if (!denied) invalidBoundary();
  return false;
}

function assertGrantStatements(rows) {
  const expectedTables = new Set(AUTHORITY.tables);
  const exactGrantees = new Set([
    "'dashboard_zaruku_reader'@'127.0.0.1'",
    '`dashboard_zaruku_reader`@`127.0.0.1`',
  ]);
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length !== 1) invalidBoundary();
    const grant = Object.values(row)[0];
    if (typeof grant !== 'string') invalidBoundary();
    const usageGrant = grant.match(/^GRANT USAGE ON \*\.\* TO\s+(.+)$/i);
    if (usageGrant && exactGrantees.has(usageGrant[1])) continue;
    const tableGrant = grant.match(/^GRANT SELECT ON `?report_bd`?\.`?([a-z][a-z0-9_]*)`? TO\s+(.+)$/i);
    if (!tableGrant || !expectedTables.has(tableGrant[1]) || !exactGrantees.has(tableGrant[2])) invalidBoundary();
  }
}

function frozenEvidence() {
  return Object.freeze({
    account: ACCOUNT,
    globalPrivileges: Object.freeze([]),
    schemaPrivileges: Object.freeze([]),
    tableSelectCount: AUTHORITY.tables.length,
    unexpectedPrivileges: Object.freeze([]),
    canSelectAllowedFamilies: true,
    canWriteCanonicalFacts: false,
    canReadPrivateSchema: false,
    canReadAdvertisingOnlyFact: false,
  });
}

/**
 * @typedef {{
 *   account: string,
 *   globalPrivileges: readonly string[],
 *   schemaPrivileges: readonly string[],
 *   tableSelectCount: number,
 *   unexpectedPrivileges: readonly string[],
 *   canSelectAllowedFamilies: boolean,
 *   canWriteCanonicalFacts: boolean,
 *   canReadPrivateSchema: boolean,
 *   canReadAdvertisingOnlyFact: boolean,
 * }} DbBoundaryEvidence
 */

/**
 * Verify metadata and active positive/negative probes without returning database rows.
 * @returns {Promise<DbBoundaryEvidence>}
 */
export async function verifyReaderBoundary(adminAdapter, readerAdapter) {
  try {
    assertAdapter(adminAdapter, ['query']);
    assertAdapter(readerAdapter, ['query']);
    const readerIdentityRows = assertRows(await readerAdapter.query(
      'SELECT CURRENT_USER() AS currentUser',
    ), ['currentUser']);
    if (!isDeepStrictEqual(readerIdentityRows, [{ currentUser: ACCOUNT }])) invalidBoundary();

    const accountRows = assertRows(await adminAdapter.query(
      'SELECT User AS user, Host AS host FROM mysql.user WHERE User = ?',
      [ACCOUNT_USER],
    ), ['host', 'user']);
    if (!isDeepStrictEqual(accountRows, [{ user: ACCOUNT_USER, host: ACCOUNT_HOST }])) invalidBoundary();

    const globalRows = assertRows(await adminAdapter.query(
      "SELECT PRIVILEGE_TYPE AS privilegeType FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ? AND PRIVILEGE_TYPE <> 'USAGE'",
      [ACCOUNT_SQL],
    ), ['privilegeType']);
    const schemaRows = assertRows(await adminAdapter.query(
      'SELECT TABLE_SCHEMA AS tableSchema, PRIVILEGE_TYPE AS privilegeType FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ?',
      [ACCOUNT_SQL],
    ), ['privilegeType', 'tableSchema']);
    if (globalRows.length || schemaRows.length) invalidBoundary();

    const tableRows = assertRows(await adminAdapter.query(
      'SELECT TABLE_SCHEMA AS tableSchema, TABLE_NAME AS tableName, PRIVILEGE_TYPE AS privilegeType, IS_GRANTABLE AS isGrantable FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ?',
      [ACCOUNT_SQL],
    ), ['isGrantable', 'privilegeType', 'tableName', 'tableSchema']);
    const expectedTableRows = AUTHORITY.tables.map(tableName => ({
      tableSchema: AUTHORITY.database,
      tableName,
      privilegeType: 'SELECT',
      isGrantable: 'NO',
    }));
    const sortedTableRows = [...tableRows].sort((left, right) => left.tableName.localeCompare(right.tableName));
    if (!isDeepStrictEqual(sortedTableRows, expectedTableRows)) invalidBoundary();

    const placeholders = AUTHORITY.tables.map(() => '?').join(', ');
    const objectRows = assertRows(await adminAdapter.query(
      `SELECT TABLE_NAME AS tableName, TABLE_TYPE AS tableType FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`,
      [AUTHORITY.database, ...AUTHORITY.tables],
    ), ['tableName', 'tableType']);
    const expectedObjects = AUTHORITY.tables.map(tableName => ({ tableName, tableType: 'BASE TABLE' }));
    const sortedObjects = [...objectRows].sort((left, right) => left.tableName.localeCompare(right.tableName));
    if (!isDeepStrictEqual(sortedObjects, expectedObjects)) invalidBoundary();

    const grants = await adminAdapter.query(`SHOW GRANTS FOR ${ACCOUNT_SQL}`);
    if (!Array.isArray(grants)) invalidBoundary();
    assertGrantStatements(grants);

    for (const table of AUTHORITY.tables) {
      const rows = await readerAdapter.query(
        `SELECT COUNT(*) AS rowCount FROM \`${AUTHORITY.database}\`.\`${table}\` WHERE 1 = 0`,
      );
      if (!rowCountIsNonnegative(rows)) invalidBoundary();
    }
    await expectWriteDenied(readerAdapter);
    await expectDenied(
      readerAdapter,
      'SELECT COUNT(*) AS rowCount FROM `report_bd_private`.`canonical_fact_metrika_visits` WHERE 1 = 0',
    );
    await expectDenied(
      readerAdapter,
      'SELECT COUNT(*) AS rowCount FROM `report_bd`.`canonical_fact_ads_daily` WHERE 1 = 0',
    );
    return frozenEvidence();
  } catch {
    throw new Error('Zaruku MySQL reader boundary verification failed');
  }
}

function readPassword(passwordFd) {
  if (!Number.isSafeInteger(passwordFd) || passwordFd < 3) invalidBoundary();
  const bytes = fs.readFileSync(passwordFd);
  try {
    return bytes.toString('utf8');
  } finally {
    bytes.fill(0);
  }
}

async function acquireCreationLock(adapter) {
  const rows = assertRows(await adapter.query(
    'SELECT GET_LOCK(?, ?) AS acquired',
    [CREATION_LOCK, CREATION_LOCK_TIMEOUT_SECONDS],
  ), ['acquired']);
  if (rows.length !== 1 || Number(rows[0].acquired) !== 1) invalidBoundary();
}

async function releaseCreationLock(adapter) {
  const rows = assertRows(await adapter.query(
    'SELECT RELEASE_LOCK(?) AS released',
    [CREATION_LOCK],
  ), ['released']);
  if (rows.length !== 1 || Number(rows[0].released) !== 1) invalidBoundary();
}

/**
 * First-create, grant, and verify the reader. The adapter is the injected local-socket boundary.
 * @returns {Promise<DbBoundaryEvidence>}
 */
export async function applyReaderBoundary(adapter, passwordFd, hooks = {}) {
  let cleanupOwnedAccount = false;
  let lockHeld = false;
  let readerAdapter;
  let evidence;
  let failed = false;
  try {
    assertAdapter(adapter, ['context', 'openReader', 'query']);
    const context = await adapter.context();
    if (!exactKeys(context, CONTEXT_KEYS) || context.platform !== 'linux' ||
        context.effectiveUid !== 0 || context.protocol !== 'socket' ||
        context.currentUser !== 'root@localhost') invalidBoundary();

    await acquireCreationLock(adapter);
    lockHeld = true;

    const existing = assertRows(await adapter.query(
      'SELECT User AS user, Host AS host FROM mysql.user WHERE User = ?',
      [ACCOUNT_USER],
    ), ['host', 'user']);
    if (existing.length) invalidBoundary();

    const password = Buffer.isBuffer(passwordFd) ? passwordFd.toString('utf8') : readPassword(passwordFd);
    const operations = buildReaderSql(AUTHORITY, password);
    await adapter.query(operations[0].sql, operations[0].params);
    cleanupOwnedAccount = true;
    await hooks.created?.();
    for (const operation of operations.slice(1)) await adapter.query(operation.sql, operation.params);
    readerAdapter = await adapter.openReader(password);
    evidence = await verifyReaderBoundary(adapter, readerAdapter);
    await hooks.verified?.(password, evidence);
    cleanupOwnedAccount = false;
  } catch {
    failed = true;
    if (cleanupOwnedAccount) {
      try {
        await adapter.query(`DROP USER IF EXISTS ${ACCOUNT_SQL}`);
        await hooks.dropped?.();
      } catch {
        // The public error remains sanitized even if cleanup also fails.
      }
    }
  } finally {
    if (readerAdapter && typeof readerAdapter.close === 'function') {
      try {
        await readerAdapter.close();
      } catch {
        // Connection close does not change the already verified privilege boundary.
      }
    }
    if (lockHeld) {
      try {
        await releaseCreationLock(adapter);
      } catch {
        failed = true;
      }
    }
  }
  if (failed || !evidence) throw new Error('Failed to apply Zaruku MySQL reader boundary');
  return evidence;
}
