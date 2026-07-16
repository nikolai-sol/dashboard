import path from "node:path";

import { findPrivatePublicAssets, findPrivateReleaseAssets } from "../src/lib/release-asset-policy";

const releaseMode = process.argv.includes("--release");
const rootArgument = process.argv.slice(2).find((argument) => argument !== "--release");
const scanRoot = path.resolve(process.cwd(), rootArgument || "public");
const prohibitedAssets = releaseMode
  ? findPrivateReleaseAssets(scanRoot)
  : findPrivatePublicAssets(scanRoot);

if (prohibitedAssets.length > 0) {
  console.error("Prohibited Abbott source assets found in the public release tree:");
  for (const asset of prohibitedAssets) console.error(`- ${asset}`);
  process.exit(1);
}

console.log(`Public asset policy passed for ${scanRoot}`);
