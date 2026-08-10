import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAbbottPagePath, normalizeAbbottPageUrl } from "@/lib/abbott-page-url";

test("normalizes absolute Abbott page URLs without tracking identity", () => {
  assert.equal(
    normalizeAbbottPageUrl("HTTPS://ABBOTT.EXAMPLE//gastro/?utm_source=email#part"),
    "https://abbott.example/gastro",
  );
  assert.equal(normalizeAbbottPageUrl("https://abbott.example/"), "https://abbott.example/");
});

test("normalizes relative page paths consistently", () => {
  assert.equal(normalizeAbbottPageUrl("//gastro///article/?secret=yes#part"), "/gastro/article");
  assert.equal(normalizeAbbottPageUrl(""), "");
  assert.equal(normalizeAbbottPageUrl("/"), "/");
});

test("normalizes Abbott return-page paths independently of origin", () => {
  assert.equal(normalizeAbbottPagePath("HTTPS://ABBOTT.EXAMPLE//gastro/?utm_source=email#part"), "/gastro");
  assert.equal(normalizeAbbottPagePath("gastro///article/?secret=yes#part"), "/gastro/article");
  assert.equal(normalizeAbbottPagePath("//gastro///"), "/gastro");
  assert.equal(normalizeAbbottPagePath("https://ABBOTT.example///"), "/");
  assert.equal(normalizeAbbottPagePath(""), "");
});
