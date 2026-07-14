/* eslint-disable @typescript-eslint/no-require-imports */
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");

const WEBMASTER_API_BASE = "https://api.webmaster.yandex.net/v4";
const OAUTH_TOKEN_URL = "https://oauth.yandex.ru/token";
const DEFAULT_ACCOUNT_ID = "66624469";
const DEFAULT_DOMAIN = "zaruku.ru";
const DEFAULT_DEVICE = "ALL";

function loadEnvFile(filePath) {
  return fs.readFile(filePath, "utf8").then((content) => {
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const key = line.slice(0, line.indexOf("=")).trim();
      let value = line.slice(line.indexOf("=") + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }).catch((error) => {
    if (!error || error.code !== "ENOENT") throw error;
  });
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function isoWeeksInYear(year) {
  const januaryFirstDate = new Date(Date.UTC(year, 0, 1));
  const januaryFirst = januaryFirstDate.getUTCDay() || 7;
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return januaryFirst === 4 || (januaryFirst === 3 && isLeapYear) ? 53 : 52;
}

function isoWeekFromDate(date) {
  const current = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = current.getUTCDay() || 7;
  current.setUTCDate(current.getUTCDate() + 4 - day);
  const year = current.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((current.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${year}-W${pad(Math.min(week, isoWeeksInYear(year)))}`;
}

function completedIsoWeekBefore(now = new Date()) {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = today.getUTCDay() || 7;
  const mondayThisWeek = new Date(today);
  mondayThisWeek.setUTCDate(today.getUTCDate() - day + 1);
  const monday = new Date(mondayThisWeek);
  monday.setUTCDate(mondayThisWeek.getUTCDate() - 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { weekKey: isoWeekFromDate(monday), from: isoDate(monday), to: isoDate(sunday) };
}

function weekRangeFromKey(weekKey) {
  const match = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/.exec(weekKey);
  if (!match) throw new Error(`Invalid ISO week: ${weekKey}`);
  const year = Number(match[1]);
  const week = Number(match[2]);
  if (week > isoWeeksInYear(year)) throw new Error(`Invalid ISO week: ${weekKey}`);
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const weekOneMonday = new Date(januaryFourth);
  weekOneMonday.setUTCDate(januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() || 7) - 1));
  const monday = new Date(weekOneMonday);
  monday.setUTCDate(weekOneMonday.getUTCDate() + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { weekKey, from: isoDate(monday), to: isoDate(sunday) };
}

function asNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateCtr(impressions, clicks) {
  return impressions > 0 ? Math.round((clicks / impressions) * 100_000_000) / 1_000_000 : null;
}

function normalizePopularQueryRows(payload, device) {
  return (payload.queries || []).map((row) => {
    const indicators = row.indicators || {};
    const impressions = Math.round(asNumber(indicators.TOTAL_SHOWS));
    const clicks = Math.round(asNumber(indicators.TOTAL_CLICKS));
    return {
      queryId: String(row.query_id || row.query_text || ""),
      queryText: String(row.query_text || ""),
      device,
      impressions,
      clicks,
      ctr: calculateCtr(impressions, clicks),
      averagePosition: Number.isFinite(Number(indicators.AVG_SHOW_POSITION)) ? Number(indicators.AVG_SHOW_POSITION) : null,
      raw: row,
    };
  }).filter((row) => row.queryId && row.queryText);
}

function aggregateStatistics(statistics) {
  const totals = { impressions: 0, clicks: 0, ctr: null, averagePosition: null };
  let positionWeight = 0;
  let ctrWeight = 0;
  for (const item of statistics || []) {
    const field = item.field;
    const value = asNumber(item.value);
    if (field === "IMPRESSIONS") totals.impressions += value;
    if (field === "CLICKS") totals.clicks += value;
    if (field === "POSITION") {
      totals.averagePosition = (totals.averagePosition || 0) + value;
      positionWeight += 1;
    }
    if (field === "CTR") {
      totals.ctr = (totals.ctr || 0) + value;
      ctrWeight += 1;
    }
  }
  return {
    impressions: Math.round(totals.impressions),
    clicks: Math.round(totals.clicks),
    ctr: ctrWeight > 0 ? totals.ctr / ctrWeight : calculateCtr(totals.impressions, totals.clicks),
    averagePosition: positionWeight > 0 ? totals.averagePosition / positionWeight : null,
  };
}

function normalizeAnalyticsPageRows(payload, device) {
  return (payload.text_indicator_to_statistics || []).flatMap((row) => {
    const indicator = row.text_indicator || {};
    if (indicator.type !== "URL" || !indicator.value) return [];
    const metrics = aggregateStatistics(row.statistics || []);
    return [{
      url: String(indicator.value),
      device,
      impressions: metrics.impressions,
      clicks: metrics.clicks,
      ctr: metrics.ctr,
      averagePosition: metrics.averagePosition,
      raw: row,
    }];
  });
}

async function refreshYandexToken(config, postToken = postYandexToken, writeState = writeTokenState) {
  const payload = await postToken({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    refreshToken: config.refreshToken,
  });
  if (!payload.access_token) throw new Error("Yandex OAuth response did not include access token");
  const expiresAt = new Date(Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 60) * 1000).toISOString();
  const refreshToken = payload.refresh_token || config.refreshToken;
  if (config.tokenStatePath) {
    await writeState(config.tokenStatePath, {
      access_token: payload.access_token,
      refresh_token: refreshToken,
      expires_at: expiresAt,
    });
  }
  return { accessToken: payload.access_token, refreshToken, expiresAt };
}

async function postYandexToken(config) {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", config.refreshToken);
  params.set("client_id", config.clientId);
  params.set("client_secret", config.clientSecret);
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!response.ok) throw new Error(`Yandex OAuth refresh failed: ${response.status}`);
  return response.json();
}

async function writeTokenState(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(tempPath, 0o600);
  await fs.rename(tempPath, filePath);
  await fs.chmod(filePath, 0o600);
}

async function readTokenState(filePath) {
  if (!filePath) return null;
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
}

function normalizeHostUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return String(value || "").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  }
}

async function discoverHostId(domain, listHosts) {
  const payload = await listHosts();
  const matches = (payload.hosts || []).filter((host) => normalizeHostUrl(host.ascii_host_url || host.host_url || "") === domain);
  if (matches.length === 0) throw new Error(`No Yandex Webmaster host found for ${domain}`);
  if (matches.length > 1) throw new Error(`Ambiguous Yandex Webmaster hosts for ${domain}`);
  return matches[0].host_id;
}

async function webmasterFetchJson(accessToken, pathPart, options = {}) {
  const response = await fetch(`${WEBMASTER_API_BASE}${pathPart}`, {
    ...options,
    headers: {
      Authorization: `OAuth ${accessToken}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json; charset=UTF-8" } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Yandex Webmaster API failed: ${response.status} ${message.slice(0, 240)}`);
  }
  return response.json();
}

async function getUserId(accessToken) {
  const payload = await webmasterFetchJson(accessToken, "/user/");
  return payload.user_id || payload.userId || payload.id;
}

async function fetchAllPopularQueries(accessToken, userId, hostId, week, device) {
  const allRows = [];
  for (let offset = 0; ; offset += 500) {
    const params = new URLSearchParams({
      order_by: "TOTAL_SHOWS",
      device_type_indicator: device,
      date_from: week.from,
      date_to: week.to,
      offset: String(offset),
      limit: "500",
    });
    params.append("query_indicator", "TOTAL_SHOWS");
    params.append("query_indicator", "TOTAL_CLICKS");
    params.append("query_indicator", "AVG_SHOW_POSITION");
    const payload = await webmasterFetchJson(accessToken, `/user/${userId}/hosts/${encodeURIComponent(hostId)}/search-queries/popular/?${params.toString()}`);
    allRows.push(...normalizePopularQueryRows(payload, device));
    const count = asNumber(payload.count);
    if ((payload.queries || []).length < 500 || allRows.length >= count) break;
  }
  return allRows;
}

async function fetchAllAnalyticsPages(accessToken, userId, hostId, week, device) {
  const allRows = [];
  for (let offset = 0; ; offset += 500) {
    const body = {
      offset,
      limit: 500,
      device_type_indicator: device,
      search_location: "ALL_LOCATIONS_ORGANIC",
      text_indicator: "URL",
      sort_by_date: { date: week.to, statistic_field: "IMPRESSIONS", by: "DESC" },
    };
    const payload = await webmasterFetchJson(accessToken, `/user/${userId}/hosts/${encodeURIComponent(hostId)}/query-analytics/list`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    const rows = normalizeAnalyticsPageRows(payload, device);
    allRows.push(...rows);
    const count = asNumber(payload.count);
    if (rows.length < 500 || allRows.length >= count) break;
  }
  return allRows;
}

function pageHash(url) {
  return crypto.createHash("sha256").update(url).digest("hex");
}

async function replaceWeekRowsTransaction(conn, snapshot) {
  try {
    await conn.beginTransaction();
    // DEPRECATED: legacy weekly Webmaster snapshot tables are kept only until TASK-062 removes the writer.
    // Dashboard panels must read canonical_fact_webmaster_*_daily aggregated by ISO week instead.
    await conn.execute(
      "DELETE FROM seo_webmaster_queries_weekly WHERE analytics_account_id = ? AND week_key = ? AND device_type = ?",
      [snapshot.accountId, snapshot.weekKey, snapshot.device],
    );
    await conn.execute(
      "DELETE FROM seo_webmaster_pages_weekly WHERE analytics_account_id = ? AND week_key = ? AND device_type = ?",
      [snapshot.accountId, snapshot.weekKey, snapshot.device],
    );
    for (const row of snapshot.queryRows) {
      await conn.execute(
        `INSERT INTO seo_webmaster_queries_weekly
          (analytics_account_id, host_id, week_key, week_from, week_to, device_type, query_id, query_text, impressions, clicks, ctr, average_position, raw_payload, ingestion_run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.accountId,
          snapshot.hostId,
          snapshot.weekKey,
          snapshot.weekFrom,
          snapshot.weekTo,
          row.device,
          row.queryId,
          row.queryText,
          row.impressions,
          row.clicks,
          row.ctr,
          row.averagePosition,
          JSON.stringify(row.raw || {}),
          snapshot.runId,
        ],
      );
    }
    for (const row of snapshot.pageRows) {
      await conn.execute(
        `INSERT INTO seo_webmaster_pages_weekly
          (analytics_account_id, host_id, week_key, week_from, week_to, device_type, page_url, page_hash, impressions, clicks, ctr, average_position, raw_payload, ingestion_run_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshot.accountId,
          snapshot.hostId,
          snapshot.weekKey,
          snapshot.weekFrom,
          snapshot.weekTo,
          row.device,
          row.url,
          pageHash(row.url),
          row.impressions,
          row.clicks,
          row.ctr,
          row.averagePosition,
          JSON.stringify(row.raw || {}),
          snapshot.runId,
        ],
      );
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

function parseArgs(argv) {
  const result = {};
  for (const arg of argv) {
    if (arg.startsWith("--week=")) result.week = arg.slice("--week=".length);
    if (arg.startsWith("--domain=")) result.domain = arg.slice("--domain=".length);
    if (arg.startsWith("--account=")) result.accountId = arg.slice("--account=".length);
  }
  return result;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

async function createPoolFromEnv() {
  return mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || process.env.MYSQL_PORT || 3306),
    user: process.env.DB_USER || requireEnv("MYSQL_USER"),
    password: process.env.DB_PASSWORD || requireEnv("MYSQL_PASSWORD"),
    database: process.env.DB_NAME || process.env.MYSQL_DB || "report_bd",
    waitForConnections: true,
    connectionLimit: 4,
  });
}

async function createRun(pool, week) {
  const [result] = await pool.execute(
    `INSERT INTO canonical_collector_runs (source_key, run_type, run_mode, job_key, date_from, date_to, status)
     VALUES ('yandex_webmaster', 'manual', 'weekly', ?, ?, ?, 'running')`,
    [`yandex_webmaster:${week.weekKey}`, week.from, week.to],
  );
  return result.insertId;
}

async function finishRun(pool, runId, status, rowsRead, rowsWritten, errorSummary = null) {
  await pool.execute(
    `UPDATE canonical_collector_runs
     SET status = ?, rows_read = ?, rows_written = ?, error_count = ?, error_summary = ?, finished_at = NOW(), duration_ms = TIMESTAMPDIFF(MICROSECOND, started_at, NOW()) / 1000
     WHERE id = ?`,
    [status, rowsRead, rowsWritten, status === "success" ? 0 : 1, errorSummary, runId],
  );
}

async function resolveAccessToken(config) {
  const state = await readTokenState(config.tokenStatePath);
  if (state && state.access_token && state.expires_at && new Date(state.expires_at).getTime() > Date.now() + 60_000) {
    return { accessToken: state.access_token, refreshToken: state.refresh_token || config.refreshToken, expiresAt: state.expires_at };
  }
  return refreshYandexToken({ ...config, refreshToken: state?.refresh_token || config.refreshToken });
}

async function collectYandexWebmaster(options = {}) {
  await loadEnvFile(path.join(process.cwd(), ".env"));
  await loadEnvFile(path.join(process.cwd(), ".env.local"));
  if ((process.env.YANDEX_WEBMASTER_ENABLED || "true") === "false") {
    return { status: "skipped", rowsRead: 0, rowsWritten: 0 };
  }
  const args = { ...parseArgs(process.argv.slice(2)), ...options };
  const week = args.week ? weekRangeFromKey(args.week) : completedIsoWeekBefore();
  const accountId = args.accountId || process.env.YANDEX_WEBMASTER_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
  const domain = args.domain || process.env.YANDEX_WEBMASTER_DOMAIN || DEFAULT_DOMAIN;
  const device = process.env.YANDEX_WEBMASTER_DEVICE_TYPE || DEFAULT_DEVICE;
  const tokenConfig = {
    clientId: requireEnv("YANDEX_WEBMASTER_CLIENT_ID"),
    clientSecret: requireEnv("YANDEX_WEBMASTER_CLIENT_SECRET"),
    refreshToken: requireEnv("YANDEX_WEBMASTER_REFRESH_TOKEN"),
    tokenStatePath: process.env.YANDEX_WEBMASTER_TOKEN_STATE_PATH,
  };
  const pool = await createPoolFromEnv();
  const runId = await createRun(pool, week);
  try {
    const { accessToken } = await resolveAccessToken(tokenConfig);
    const userId = await getUserId(accessToken);
    const hostId = process.env.YANDEX_WEBMASTER_HOST_ID || await discoverHostId(domain, () => webmasterFetchJson(accessToken, `/user/${userId}/hosts/`));
    const [queryRows, pageRows] = await Promise.all([
      fetchAllPopularQueries(accessToken, userId, hostId, week, device),
      fetchAllAnalyticsPages(accessToken, userId, hostId, week, device).catch(() => []),
    ]);
    const conn = await pool.getConnection();
    await replaceWeekRowsTransaction(conn, {
      accountId,
      hostId,
      weekKey: week.weekKey,
      weekFrom: week.from,
      weekTo: week.to,
      device,
      runId,
      queryRows,
      pageRows,
    });
    const rowsRead = queryRows.length + pageRows.length;
    await finishRun(pool, runId, "success", rowsRead, rowsRead);
    return { status: "success", week: week.weekKey, rowsRead, rowsWritten: rowsRead };
  } catch (error) {
    await finishRun(pool, runId, "failed", 0, 0, error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  collectYandexWebmaster()
    .then((result) => {
      console.log(JSON.stringify({ ...result, ok: true }));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

module.exports = {
  calculateCtr,
  collectYandexWebmaster,
  completedIsoWeekBefore,
  discoverHostId,
  normalizeAnalyticsPageRows,
  normalizePopularQueryRows,
  refreshYandexToken,
  replaceWeekRowsTransaction,
  weekRangeFromKey,
};
