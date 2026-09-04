import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const TEST_FILE_PATTERN = /\.test\.tsx?$/;

function walk(directory, cwd, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute, cwd, files);
    } else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) {
      files.push(path.relative(cwd, absolute).split(path.sep).join("/"));
    }
  }
}

export function discoverNodeTestFiles(cwd = process.cwd()) {
  const files = [];
  for (const rootName of ["src", "scripts"]) {
    walk(path.join(cwd, rootName), cwd, files);
  }
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

export function nodeTestArgs(files) {
  return ["--import", "tsx", "--test", ...files];
}

export function runNodeTests(cwd = process.cwd()) {
  const files = discoverNodeTestFiles(cwd);
  const result = spawnSync(process.execPath, nodeTestArgs(files), {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--list") {
    process.stdout.write(`${JSON.stringify(discoverNodeTestFiles())}\n`);
  } else if (args.length > 0) {
    process.stderr.write(`Unknown test runner argument: ${args[0]}\n`);
    process.exitCode = 1;
  } else {
    process.exitCode = runNodeTests();
  }
}
