import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { buildAuthorizedRequest, parseCredentialLines } from './compare-abbott-runtime.mjs';
import { formatVerificationFailure } from './abbott-verification-diagnostics.mjs';
import { realPlatform, runAbbottVerification } from './verify-abbott-shadow.mjs';

const ORIGINS = Object.freeze([
  ['control', 'http://127.0.0.1:3001'],
  ['candidate', 'http://127.0.0.1:3004'],
]);
const FAILURE_STAGES = Object.freeze(['authorize','launch','prepare','navigate','ready','render']);
const refuse = () => { throw new Error('ABBOTT_VERIFICATION_REFUSED'); };

export async function probePdfMatrix(input, signal, fetchImpl = fetch) {
  const credentials = parseCredentialLines(new TextDecoder('utf8', { fatal: true }).decode(input));
  const rows = [];
  try {
    if (!credentials.managerAccessToken || !credentials.embedKey) refuse();
    for (const [runtime, origin] of ORIGINS) for (const audience of ['manager','embed']) for (const alias of ['18','abbott']) {
      const credential = { kind: audience, value: audience === 'manager' ? credentials.managerAccessToken : credentials.embedKey };
      const { url, options } = buildAuthorizedRequest(origin, `/api/dashboard/${alias}/pdf`, credential);
      const started = Date.now();
      let response;
      try {
        response = await fetchImpl(url, { ...options, method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]) });
        const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        const rawStage = runtime === 'candidate' ? response.headers.get('X-Abbott-PDF-Failure-Stage') : null;
        rows.push({ runtime, audience, alias, status: response.status, type: ['application/pdf','application/json'].includes(type) ? type : 'other', failureStage: FAILURE_STAGES.includes(rawStage) ? rawStage : null, elapsedSeconds: Math.max(1, Math.ceil((Date.now() - started) / 1000)) });
      } catch {
        rows.push({ runtime, audience, alias, status: 0, type: 'failed', failureStage: null, elapsedSeconds: Math.max(1, Math.ceil((Date.now() - started) / 1000)) });
      } finally {
        await response?.body?.cancel().catch(() => {});
      }
    }
    return rows;
  } finally {
    for (const key of Object.keys(credentials)) delete credentials[key];
  }
}

async function main() {
  let rows;
  const platform = {
    ...realPlatform,
    async consume(_mode, input, signal) {
      rows = await probePdfMatrix(input, signal);
      return { status: 0, stdout: Buffer.from('smoke=passed checks=1\n'), stderr: Buffer.alloc(0) };
    },
  };
  const result = await runAbbottVerification('smoke', platform);
  process.stdout.write(`${JSON.stringify({ pdfMatrix: rows, forward: result.forward })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 2) { process.stderr.write('ABBOTT_VERIFICATION_REFUSED stage=setup reason=failed\n');process.exitCode=1; }
  else await main().catch(error => { process.stderr.write(formatVerificationFailure(error));process.exitCode=1; });
}
