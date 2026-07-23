import assert from "node:assert/strict";
import test from "node:test";
import { resolveZarukuContentUrl } from "./zaruku-url";

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
