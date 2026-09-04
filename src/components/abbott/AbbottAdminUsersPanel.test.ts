import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AbbottAdminUsersPanel.tsx", import.meta.url), "utf8");

test("panel loads lazily and updates the visible list only after a valid response", () => {
  assert.match(source, /if \(!open\) return;[\s\S]*?fetch\(endpoint\(\)/);
  assert.match(source, /if \(!response\.ok \|\| !validResponse\(payload\)\) throw[\s\S]*?setUserIds\(payload\.user_ids\)/);
  assert.match(source, /catch \{[\s\S]*?setError\("Не удалось сохранить список\. Попробуйте ещё раз\."\)/);
  assert.doesNotMatch(source, /setUserIds\([^)]*filter/);
});

test("panel explains reversible filtering and exposes the requested gear label", () => {
  assert.match(source, /Список администраторов/);
  assert.match(source, /исключаются только при выборе «ВСЕ без админов»/);
  assert.match(source, /Исходные данные не изменяются/);
});
