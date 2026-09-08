import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeBootEnvironment } from './runtime-release-remote.mjs';

const clean = () => ({ NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '32123' });
test('boot accepts only the exact environment and normalizes the exact amd64 translation marker', () => {
  for (const env of [clean(), { ...clean(), UV_USE_IO_URING: '0' }]) {
    normalizeBootEnvironment(env);
    assert.deepEqual(env, clean());
  }
});
test('boot rejects other translation values, unknown keys and changed fixed inputs without printing them', () => {
  for (const env of [{ ...clean(), UV_USE_IO_URING: '1' }, { ...clean(), UV_USE_IO_URING: '' }, { ...clean(), UV_USE_IO_URING: '00' }, { ...clean(), PARENT_SENTINEL: 'PRIVATE_MARKER' }, { ...clean(), NODE_ENV: 'development' }, { ...clean(), HOSTNAME: '0.0.0.0' }, { ...clean(), PORT: '0' }, { ...clean(), PORT: '65536' }]) {
    assert.throws(() => normalizeBootEnvironment(env), error => error.message === 'Zaruku boot environment mismatch');
  }
});
