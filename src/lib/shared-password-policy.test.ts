import assert from "node:assert/strict";
import test from "node:test";
import { validateSharedPasswordChange } from "./shared-password-policy";

test("shared password validation is exact and bounded", () => {
  assert.deepEqual(validateSharedPasswordChange({ new_password: "0123456789", confirm_password: "0123456789" }), { ok: true, password: "0123456789" });
  assert.equal(validateSharedPasswordChange({ new_password: "short", confirm_password: "short" }).ok, false);
  assert.equal(validateSharedPasswordChange({ new_password: "0123456789", confirm_password: "012345678X" }).ok, false);
  assert.equal(validateSharedPasswordChange({ new_password: "x".repeat(257), confirm_password: "x".repeat(257) }).ok, false);
});
