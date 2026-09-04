import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { abbottTitleLookupHash } from "./abbott-content-lookup";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

test("Abbott title lookup matches canonical NFKC and whitespace normalization", () => {
  assert.equal(
    abbottTitleLookupHash("  Ａbbott\u00a0\u00a0Guide  "),
    sha256("Abbott Guide"),
  );
});
