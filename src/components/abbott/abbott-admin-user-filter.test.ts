import assert from "node:assert/strict";
import test from "node:test";

import {
  ABBOTT_WITHOUT_ADMINS,
  abbottAdminUsersApiPath,
  buildAbbottAdminUserOptions,
  normalizeAbbottAdminUserInput,
} from "./abbott-admin-user-filter";

test("admin-free option precedes exact User IDs only when settings are available", () => {
  assert.deepEqual(buildAbbottAdminUserOptions(["900001", "000001"], true), [
    { value: ABBOTT_WITHOUT_ADMINS, label: "ВСЕ без админов" },
    { value: "000001", label: "000001" },
    { value: "900001", label: "900001" },
  ]);
  assert.deepEqual(buildAbbottAdminUserOptions(["900001"], false), [
    { value: "900001", label: "900001" },
  ]);
});

test("settings endpoint carries only the manager access token from the dashboard URL", () => {
  assert.equal(
    abbottAdminUsersApiPath("abbott", "?from=2026-08-01&access_token=manager-secret&embed_key=ignored"),
    "/api/dashboard/abbott/abbott-admin-users?access_token=manager-secret",
  );
});

test("multiline admin input keeps exact digit IDs, removes duplicates, and rejects invalid values", () => {
  assert.deepEqual(normalizeAbbottAdminUserInput("900001\n 000001\n900001"), {
    ok: true,
    userIds: ["900001", "000001"],
  });
  assert.deepEqual(normalizeAbbottAdminUserInput("900001\nadmin-2"), {
    ok: false,
    userIds: [],
  });
});
