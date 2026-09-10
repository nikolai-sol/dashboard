import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { planRuntimeAction, readReleaseManifest, assertReleaseLineage } from "./site-seo-runtime-release.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function previewRollback(manifestFilename, repositoryFilename) {
  const manifest = readReleaseManifest(manifestFilename);
  const repository = JSON.parse(fs.readFileSync(repositoryFilename, "utf8"));
  assertReleaseLineage(manifest, repository);
  return planRuntimeAction(manifest, "rollback");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv.includes("--preview")) throw new Error("live site-seo rollback is disabled in this fixture policy; use --preview");
    const index = process.argv.indexOf("--manifest");
    const manifest = index >= 0 ? process.argv[index + 1] : path.join(ROOT, "deploy/medroche/release.json");
    const repository = path.join(ROOT, "deploy/medroche/repository.json");
    process.stdout.write(`${JSON.stringify(previewRollback(path.resolve(manifest), repository))}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
