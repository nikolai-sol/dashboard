#!/usr/bin/env node
"use strict";

const CANONICAL_COMMAND =
  "bash scripts/collect-yandex-webmaster-canonical.sh --run-type cron";

function disabledLegacyCollector() {
  return {
    status: "disabled",
    reason: "canonical_daily_collector_is_the_only_writer",
    canonicalCommand: CANONICAL_COMMAND,
  };
}

if (require.main === module) {
  const result = disabledLegacyCollector();
  console.error(
    `Legacy Yandex Webmaster collector is disabled. Use: ${result.canonicalCommand}`,
  );
  process.exitCode = 2;
}

module.exports = {
  CANONICAL_COMMAND,
  disabledLegacyCollector,
};
