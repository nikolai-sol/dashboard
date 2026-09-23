import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

test('isolated Zaruku stylesheet emits shared dashboard layout utilities', async () => {
  const app = path.resolve('apps/zaruku');
  const from = path.join(app, 'src/app/globals.css');
  const result = await postcss([tailwindcss({ base: app, optimize: false })])
    .process(await readFile(from, 'utf8'), { from });
  const rules = new Map<string, string>();
  result.root.walkRules(rule => { rules.set(rule.selector, rule.toString()); });
  assert.match(rules.get('.grid') ?? '', /display:\s*grid/, 'KPI cards need CSS grid');
  assert.ok(rules.has('.xl\\:grid-cols-4'), 'desktop KPI columns must be emitted');
  assert.ok(rules.has('.gap-3'), 'shared component spacing must be emitted');
});
