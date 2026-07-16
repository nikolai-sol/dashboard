import path from "node:path";

import { findForbiddenPublicAssets, findPrivateReleaseAssets } from "../src/lib/release-asset-policy";

const releaseMode = process.argv.includes("--release");
const rootArgument = process.argv.slice(2).find((argument) => argument !== "--release");
const scanRoot = path.resolve(process.cwd(), rootArgument || "public");
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
