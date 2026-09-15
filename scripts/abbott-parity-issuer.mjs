import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const refuse = () => { throw new Error('ABBOTT_ISSUER_REFUSED'); };
const VERSION_QUERY = String.raw`
import json,sys,mysql.connector
try:
 raw=sys.stdin.buffer.read(65537)
 if len(raw)>65536: raise ValueError()
 e=json.loads(raw)
 c=mysql.connector.connect(host=e['host'],port=e['port'],user=e['user'],password=e['password'],database='report_bd',connection_timeout=5)
 try:
  q=c.cursor()
  q.execute("SELECT s.credential_version FROM report_bd.dashboard_shared_access_settings s JOIN report_bd.dashboards d ON d.id=s.dashboard_id WHERE d.id=18 AND d.client_id='abbott' AND d.is_active=1")
  rows=q.fetchall()
  if len(rows)!=1 or type(rows[0][0]) is not int or rows[0][0]<1: raise ValueError()
  sys.stdout.write(str(rows[0][0])+'\n')
  q.close()
 finally: c.close()
except Exception:
 sys.stderr.write('ABBOTT_VERSION_REFUSED\n')
 sys.exit(1)
`;

export function readCurrentVersion(values, execute = spawnSync) {
  let input, result;
  try {
    if (values.DB_NAME !== 'report_bd' || !/^\d+$/.test(values.DB_PORT ?? '')) refuse();
    if (Number(values.DB_PORT) < 1 || Number(values.DB_PORT) > 65535 || ['DB_HOST','DB_USER','DB_PASSWORD'].some(key => typeof values[key] !== 'string' || !values[key].trim() || /[\x00-\x1f\x7f]/.test(values[key]))) refuse();
    input = Buffer.from(JSON.stringify({ host: values.DB_HOST, port: Number(values.DB_PORT), user: values.DB_USER, password: values.DB_PASSWORD }));
    if (input.length > 65536) refuse();
    result = execute('/root/reportingdash-canonical/venv/bin/python', ['-c', VERSION_QUERY], {
      input, env: {}, timeout: 10000, maxBuffer: 1024, stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.status !== 0 || result.signal || result.error || result.stderr?.length || !Buffer.isBuffer(result.stdout) || !/^[1-9]\d*\n$/.test(result.stdout.toString())) refuse();
    const version = Number(result.stdout.toString().trim());
    if (!Number.isSafeInteger(version)) refuse();
    return version;
  } catch { refuse(); }
  finally { input?.fill(0); result?.stdout?.fill(0); result?.stderr?.fill(0); }
}

function signManagerToken(secret, version, timestamp) {
  let key;
  try {
    // Same JSON/base64url/HMAC-SHA256 wire contract as the attested access-auth.
    // No source code is accepted or executed by the signing path.
    key = Buffer.from(secret.trim(), 'utf8');
    const part = Buffer.from(JSON.stringify({ type: 'viewer', dashboard_id: 18, audience: 'manager', credential_version: version, exp: timestamp + 600 }), 'utf8').toString('base64url');
    return `${part}.${crypto.createHmac('sha256', key).update(part).digest('base64url')}`;
  } catch { refuse(); }
  finally { key?.fill(0); }
}

export function createOneShotIssuer({ outputPipe, readSource, readVersion = readCurrentVersion, now = () => Math.floor(Date.now() / 1000) }) {
  let consumed = false;
  return async () => {
    let values, repeated, frame;
    try {
      if (consumed) refuse();
      consumed = true;
      if (!outputPipe()) refuse();
      values = readSource();
      for (const key of ['DASHBOARD_AUTH_SECRET', 'ABBOTT_DASHBOARD_EMBED_KEY']) {
        if (typeof values[key] !== 'string' || !values[key].trim() || /[\x00-\x1f\x7f]/.test(values[key])) refuse();
      }
      const version = await readVersion(values);
      if (!Number.isSafeInteger(version) || version < 1) refuse();
      repeated = readSource();
      if (JSON.stringify(values) !== JSON.stringify(repeated)) refuse();
      const timestamp = now();
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isSafeInteger(timestamp + 600)) refuse();
      const token = signManagerToken(values.DASHBOARD_AUTH_SECRET, version, timestamp);
      frame = Buffer.from(`manager_access_token\n${token}\n${values.ABBOTT_DASHBOARD_EMBED_KEY.trim()}\n`, 'utf8');
      if (frame.length > 65536 || !outputPipe()) refuse();
      return frame;
    } catch { frame?.fill(0); refuse(); }
    finally { for (const object of [values, repeated]) if (object) for (const key of Object.keys(object)) delete object[key]; }
  };
}

export async function runRemoteIssuer(readSource) {
  let frame;
  try {
    if (process.argv.length !== 1 || Object.keys(process.env).length) refuse();
    const outputPipe = () => { const stat = fs.fstatSync(1); return !process.stdout.isTTY && (stat.isFIFO() || stat.isSocket()); };
    frame = await createOneShotIssuer({ outputPipe, readSource })();
    await new Promise((resolve, reject) => process.stdout.write(frame, error => error ? reject(error) : resolve()));
  } catch { process.stderr.write('ABBOTT_ISSUER_REFUSED\n'); process.exitCode = 1; }
  finally { frame?.fill(0); }
}

// Not a standalone CLI: only the fixed orchestrator's stdin capsule calls it.
