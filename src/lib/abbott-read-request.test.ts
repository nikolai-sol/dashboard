import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

test("read request has only closed views; absent means full and invalid selectors fail explicitly", async () => {
  assert.equal(existsSync(new URL("./abbott-read-request.ts", import.meta.url)), true, "closed request parser exists");
  const { parseAbbottReadRequest, ABBOTT_READ_VIEWS, InvalidAbbottReadRequestError } = await import("./abbott-read-request");
  assert.deepEqual(parseAbbottReadRequest("https://example.test/api/dashboard/18"), { view: "full" });
  for (const view of ABBOTT_READ_VIEWS) assert.deepEqual(parseAbbottReadRequest(`https://example.test/?view=${view}`), { view });
  for (const query of ["view=", "view=unknown", "view=users_summary&view=users_summary", "view=full&view=page_stats", "view=MANAGER"]) {
    assert.throws(() => parseAbbottReadRequest(`https://example.test/?${query}`), InvalidAbbottReadRequestError);
  }
});
