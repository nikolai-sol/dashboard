import assert from "node:assert/strict";
import test from "node:test";
import { validateSharedPasswordChange } from "./shared-password-policy";

test("shared password validation requires matching strings", () => {
  assert.equal(validateSharedPasswordChange({ new_password: "0123456789", confirm_password: "012345678X" }).ok, false);
});

for (const [type, value] of [
  ["number", 1234567890],
  ["array", Array(10).fill("x")],
  ["object", {}],
] as const) {
  test(`shared password validation rejects ${type} values`, () => {
    assert.equal(validateSharedPasswordChange({ new_password: value, confirm_password: value }).ok, false);
  });
}

test("shared password validation enforces exact length boundaries", () => {
  assert.equal(validateSharedPasswordChange({ new_password: "x".repeat(9), confirm_password: "x".repeat(9) }).ok, false);
  assert.deepEqual(validateSharedPasswordChange({ new_password: "x".repeat(10), confirm_password: "x".repeat(10) }), { ok: true, password: "x".repeat(10) });
  assert.deepEqual(validateSharedPasswordChange({ new_password: "x".repeat(256), confirm_password: "x".repeat(256) }), { ok: true, password: "x".repeat(256) });
  assert.equal(validateSharedPasswordChange({ new_password: "x".repeat(257), confirm_password: "x".repeat(257) }).ok, false);
});
