import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isatty } from 'node:tty';
import { pathToFileURL } from 'node:url';
import { createHostAdapter } from './zaruku-shadow-host.mjs';

export function validateAuthDescriptor(bytes) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 65536) throw new Error();
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    // Match the complete JSON structure as well as parsing it: duplicate keys and escaped
    // alternate key spellings must not collapse into an apparently valid object.
    if (!/^\s*\{\s*"headers"\s*:\s*\{\s*"cookie"\s*:\s*"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"\s*\}\s*\}\s*$/.test(text)) throw new Error();
    const value = JSON.parse(text).headers.cookie;
    if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error();
  } catch { throw new Error('Invalid Zaruku auth descriptor'); }
}

export async function installShadowAuth(adapter) {
  let terminalState, failed = false, result;
  try {
    const identity = adapter.currentIdentity();
    if (identity.uid !== 0 || identity.euid !== 0) throw new Error();
    if (adapter.isTerminal()) terminalState = adapter.disableEcho();
    const bytes = await adapter.readStdin();
    validateAuthDescriptor(bytes);
    await adapter.publishDescriptor(bytes);
    result = { status: 'installed', sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch { failed = true; }
  finally {
    if (terminalState !== undefined) {
      try { adapter.restoreEcho(terminalState); } catch { failed = true; }
    }
  }
  if (failed) throw new Error('Failed to install Zaruku auth descriptor');
  return result;
}

export function createAuthAdapter(options = {}) {
  const adapter = options.hostAdapter ?? createHostAdapter();
  const stdin = options.stdin ?? process.stdin, signals = options.signals ?? process;
  const stty = args => {
    const result = (options.commandRunner ?? spawnSync)('/usr/bin/stty', args, { stdio: [0, 'pipe', 'pipe'], encoding: 'utf8', timeout: 5000, env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } });
    if (result.error || result.status !== 0 || result.signal) throw new Error();
    return result.stdout.trim();
  };
  adapter.isTerminal = options.isTerminal ?? (() => isatty(0));
  adapter.disableEcho = () => {
    const saved = stty(['-g']);
    if (!/^[a-fA-F0-9:]+$/.test(saved)) throw new Error();
    try { stty(['-echo', '-echonl']); }
    catch { try { stty([saved]); } catch { /* Fixed public failure. */ } throw new Error(); }
    return saved;
  };
  adapter.restoreEcho = saved => stty([saved]);
  adapter.readStdin = async () => {
    const chunks = []; let size = 0;
    const interrupt = () => stdin.destroy(new Error('Auth input interrupted'));
    signals.on('SIGINT', interrupt); signals.on('SIGTERM', interrupt);
    try {
      for await (const chunk of stdin) {
        size += chunk.length;
        if (size > 65536) throw new Error();
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, size);
    } finally {
      signals.removeListener('SIGINT', interrupt); signals.removeListener('SIGTERM', interrupt);
    }
  };
  return adapter;
}

export async function authMain() {
  process.stderr.write('Failed to install Zaruku auth descriptor; use the staged dispatcher\n'); process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await authMain();
