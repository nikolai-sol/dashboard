import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GET } from "./route";

test("Zaruku health identifies only its isolated runtime", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, scope: "zaruku" });
});

test("Zaruku config isolates its standalone assets and output", () => {
  const source = readFileSync(new URL("../../../../next.config.js", import.meta.url), "utf8");

  assert.match(source, /output:\s*["']standalone["']/);
  assert.match(source, /assetPrefix:\s*["']\/_next-zaruku["']/);
  assert.match(source, /distDir:\s*["']\.next-zaruku["']/);
  assert.match(source, /turbopack:\s*\{\s*root:\s*path\.join\(__dirname,\s*["']\.\.\/\.\.["']\)/);
});
