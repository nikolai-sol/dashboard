import assert from "node:assert/strict";
import test from "node:test";

import {
  isAbbottWebPageUrl,
  normalizeAbbottPagePath,
  normalizeAbbottPageUrl,
} from "@/lib/abbott-page-url";

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

test("rejects local files and non-web schemes from Abbott page identities", () => {
  assert.equal(isAbbottWebPageUrl("https://abbottpro.ru/gastro"), true);
  assert.equal(isAbbottWebPageUrl("/gastro/article"), true);
  assert.equal(isAbbottWebPageUrl("gastro/article"), true);
  assert.equal(isAbbottWebPageUrl("file:///C:/Users/user/Downloads/page.html"), false);
  assert.equal(isAbbottWebPageUrl("FILE:///tmp/page.html"), false);
  assert.equal(isAbbottWebPageUrl("mailto:manager@example.test"), false);
  assert.equal(isAbbottWebPageUrl("C:\\Users\\user\\page.html"), false);
  assert.equal(normalizeAbbottPageUrl("file:///C:/Users/user/Downloads/page.html"), "");
  assert.equal(normalizeAbbottPagePath("file:///C:/Users/user/Downloads/page.html"), "");
});
