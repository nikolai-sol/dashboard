#!/usr/bin/env node
import { runAliceVisibilityImportCli } from "./import-zaruku-alice-visibility";

runAliceVisibilityImportCli().catch((error) => {
  process.stderr.write(`Alice visibility import failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
