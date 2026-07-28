import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const componentsDirectory = new URL("./", import.meta.url);
const runtimeFiles = readdirSync(componentsDirectory)
  .filter((file) => (file.startsWith("Zaruku") || file.startsWith("zaruku-")))
  .filter((file) => (file.endsWith(".ts") || file.endsWith(".tsx")) && !file.endsWith(".test.ts"));

test("Zaruku runtime components contain no raw hex or rgb color literals", () => {
  const violations = runtimeFiles.flatMap((file) => {
    const source = readFileSync(new URL(file, componentsDirectory), "utf8");
    return [...source.matchAll(/#[0-9a-f]{3,8}\b|rgba?\(/gi)].map((match) => `${file}:${match.index}:${match[0]}`);
  });

  assert.deepEqual(violations, []);
});
