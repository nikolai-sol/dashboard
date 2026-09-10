import path from "node:path";
import { fileURLToPath } from "node:url";
import { planRuntimeAction, readReleaseManifest, assertReleaseLineage } from "./site-seo-runtime-release.mjs";
import fs from "node:fs";

export function previewDeploy(manifestFilename, repositoryFilename) {
  const manifest = readReleaseManifest(manifestFilename);
  const repository = JSON.parse(fs.readFileSync(repositoryFilename, "utf8"));
  assertReleaseLineage(manifest, repository);
  return planRuntimeAction(manifest, "deploy");
}

function main() {
  const argv = process.argv.slice(2);
  const preview = argv.includes("--preview");
  const manifestIndex = argv.indexOf("--manifest");
  const manifest = manifestIndex >= 0 ? argv[manifestIndex + 1] : null;
  if (!preview) throw new Error("live site-seo deploy is disabled in this fixture policy; use --preview");
  if (!manifest) throw new Error("--manifest is required");
  const repositoryIndex = argv.indexOf("--repository");
  const manifestPath = path.resolve(manifest);
  const repository = repositoryIndex >= 0 ? path.resolve(argv[repositoryIndex + 1]) : path.join(path.dirname(manifestPath), "repository.json");
  process.stdout.write(`${JSON.stringify(previewDeploy(manifestPath, repository))}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
