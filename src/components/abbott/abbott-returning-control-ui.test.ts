import assert from "node:assert/strict";
import test from "node:test";

import { returningControlEmptyMessage } from "./abbott-returning-control-ui";

test("shows a nearby empty state only for an active control-layer filter", () => {
  assert.equal(returningControlEmptyMessage(0, {}), null);
  assert.equal(
    returningControlEmptyMessage(0, { url: "https://abbottpro.ru/" }),
    "Для выбранного сочетания URL и направления данных нет.",
  );
  assert.equal(
    returningControlEmptyMessage(0, { direction: "Неврология и психиатрия [262339]" }),
    "Для выбранного сочетания URL и направления данных нет.",
  );
  assert.equal(
    returningControlEmptyMessage(1, {
      url: "https://abbottpro.ru/",
      direction: "Не относится / служебная",
    }),
    null,
  );
});
