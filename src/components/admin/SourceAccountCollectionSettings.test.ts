import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

test("Collection renders compact canonical advertising health details", () => {
  const source = readFileSync(
    path.resolve("src/components/admin/SourceAccountCollectionSettings.tsx"),
    "utf8",
  );

  assert.match(source, /Discovery/);
  assert.match(source, /Health/);
  assert.match(source, /Coverage/);
  assert.match(source, /latest_due_date/);
  assert.match(source, /latest_published_date/);
  assert.match(source, /unbound_campaign_count/);
  assert.match(source, /<details/);
});
