import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ZarukuSeoDashboard.tsx", import.meta.url), "utf8");

test("DataTable keeps behavior metric headers readable with spacing and wrapping", () => {
  assert.match(source, /min-w-\[1080px\]/);
  assert.match(source, /table-fixed/);
  assert.match(source, /px-3 pb-2 text-right font-medium leading-tight/);
  assert.match(source, /whitespace-normal/);
});
