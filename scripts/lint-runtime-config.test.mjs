import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';

test('lint ignores only generated runtime outputs and scratch while checking Abbott source', async () => {
  const eslint = new ESLint();
  for (const filename of ['apps/abbott/.next-abbott/server/generated.js', '.superpowers/sdd/scratch.cjs']) {
    assert.equal(await eslint.isPathIgnored(filename), true, `generated/scratch path must be ignored: ${filename}`);
  }
  for (const filename of ['apps/abbott/src/lint-probe.ts', 'apps/abbott/src/lint-probe.test.ts', 'scripts/deploy-runtime.mjs', 'deploy/abbott/start.cjs']) assert.equal(await eslint.isPathIgnored(filename), false);
  const results = await eslint.lintText('const invalid = require("example");\n', { filePath: 'apps/abbott/src/lint-probe.ts' });
  assert.ok(results[0].messages.some(message => message.ruleId === '@typescript-eslint/no-require-imports' && message.severity === 2));
});
