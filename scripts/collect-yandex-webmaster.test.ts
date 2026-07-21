import assert from "node:assert/strict";
import test from "node:test";
import {
  CANONICAL_COMMAND,
  disabledLegacyCollector,
} from "../scripts/collect-yandex-webmaster";

test("legacy Webmaster collector is fail-closed and points to the canonical owner", () => {
  assert.deepEqual(disabledLegacyCollector(), {
    status: "disabled",
    reason: "canonical_daily_collector_is_the_only_writer",
    canonicalCommand: CANONICAL_COMMAND,
  });
  assert.equal(
    CANONICAL_COMMAND,
    "bash scripts/collect-yandex-webmaster-canonical.sh --run-type cron",
  );
});
