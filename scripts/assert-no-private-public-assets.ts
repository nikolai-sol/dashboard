import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findForbiddenPublicAssets, findPrivateReleaseAssets } from "../src/lib/release-asset-policy";

const argumentsList = process.argv.slice(2);
const releaseMode = argumentsList.includes("--release");
const scopeIndex = argumentsList.indexOf("--scope");
const runtimeScope = scopeIndex >= 0 ? argumentsList[scopeIndex + 1] : undefined;
const rootArgument = argumentsList.find(
  (argument, index) =>
    argument !== "--release" &&
    argument !== "--scope" &&
    (scopeIndex < 0 || index !== scopeIndex + 1),
);
const scanRoot = path.resolve(process.cwd(), rootArgument || "public");
if (scopeIndex >= 0 && (!releaseMode || runtimeScope !== "zaruku" || !rootArgument)) {
  console.error("Scoped artifact inspection requires --release --scope zaruku <artifact-root>");
  process.exit(1);
}
let prohibitedAssets: string[];
try {
  prohibitedAssets = releaseMode
    ? findPrivateReleaseAssets(scanRoot)
    : findForbiddenPublicAssets(scanRoot);
} catch {
  console.error(scanRoot);
  process.exit(1);
}

if (prohibitedAssets.length > 0) {
  for (const asset of prohibitedAssets) console.error(asset);
  process.exit(1);
}

if (runtimeScope) {
  const policyScript = fileURLToPath(new URL("./runtime-artifact-policy.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [policyScript, runtimeScope, scanRoot], {
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
