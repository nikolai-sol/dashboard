import assert from "node:assert/strict";
import test from "node:test";
import {
  isHostnameWithinDomain,
  resolveAbsoluteHttpUrl,
  resolveZarukuContentUrl,
} from "./zaruku-url";

test("normalizes a relative Zaruku path", () => {
  assert.equal(resolveZarukuContentUrl("/map/clinics/42"), "https://zaruku.ru/map/clinics/42");
});

test("keeps a safe Zaruku absolute URL", () => {
  assert.equal(resolveZarukuContentUrl("https://zaruku.ru/articles/a?x=1"), "https://zaruku.ru/articles/a?x=1");
});

test("rejects foreign hosts and executable schemes", () => {
  assert.equal(resolveZarukuContentUrl("https://example.com/a"), null);
  assert.equal(resolveZarukuContentUrl("javascript:alert(1)"), null);
});

test("shares exact-domain and subdomain matching without trusting path substrings", () => {
  assert.equal(isHostnameWithinDomain("zaruku.ru", "zaruku.ru"), true);
  assert.equal(isHostnameWithinDomain("www.zaruku.ru", "zaruku.ru"), true);
  assert.equal(isHostnameWithinDomain("guides.zaruku.ru", "zaruku.ru"), true);
  assert.equal(isHostnameWithinDomain("zaruku.ru.attacker.test", "zaruku.ru"), false);
  assert.equal(isHostnameWithinDomain("attacker.test", "zaruku.ru"), false);
});

test("absolute URL contract accepts only HTTP(S) URLs with a hostname", () => {
  assert.equal(resolveAbsoluteHttpUrl("https://example.test/path"), "https://example.test/path");
  assert.equal(resolveAbsoluteHttpUrl("http://example.test/path"), "http://example.test/path");
  for (const value of [
    "/relative",
    "javascript://zaruku.ru/alert(1)",
    "data:text/html,zaruku.ru",
    "file://zaruku.ru/tmp/a",
    "mailto:test@zaruku.ru",
  ]) {
    assert.equal(resolveAbsoluteHttpUrl(value), null, value);
  }
});

test("portal URL rendering accepts safe Zaruku subdomains and rejects foreign path spoofs", () => {
  assert.equal(resolveZarukuContentUrl("https://www.zaruku.ru/article"), "https://www.zaruku.ru/article");
  assert.equal(resolveZarukuContentUrl("http://guides.zaruku.ru/article"), "http://guides.zaruku.ru/article");
  assert.equal(resolveZarukuContentUrl("https://example.test/path/zaruku.ru/article"), null);
});
