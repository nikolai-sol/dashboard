#!/usr/bin/env node
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseImportCommand = "node scripts/import-zaruku-alice-visibility.cjs";

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--outfile" && flag !== "--package-json") {
      throw new Error(`Unknown argument: ${flag}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
    if (flag === "--outfile") options.outfile = path.resolve(value);
    if (flag === "--package-json") options.packageJsonPath = path.resolve(value);
    index += 1;
  }
  if (!options.outfile) throw new Error("--outfile is required");
  return options;
}

export async function buildZarukuAliceImporter({ outfile, packageJsonPath }) {
  mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    absWorkingDir: projectRoot,
    entryPoints: ["scripts/import-zaruku-alice-visibility-release.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: ["node20"],
    legalComments: "eof",
    logLevel: "silent",
    sourcemap: false,
  });

  const artifact = readFileSync(outfile, "utf8");
  if (/\/Users\/|@esbuild\/darwin-arm64|node_modules\/tsx|get-tsconfig/.test(artifact)) {
    throw new Error("Alice importer bundle contains a build-host runtime reference");
  }

  if (packageJsonPath) {
    const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    manifest.scripts = { ...(manifest.scripts ?? {}), "import:zaruku-alice": releaseImportCommand };
    writeFileSync(packageJsonPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildZarukuAliceImporter(parseArguments(process.argv.slice(2))).catch((error) => {
    process.stderr.write(`Unable to build the Zaruku Alice importer: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
