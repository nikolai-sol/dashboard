import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const FORBIDDEN_ABBOTT_ARTIFACT = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)\.git(?:\/|$)/,
  /(^|\/)uploads?(?:\/|$)/,
  /\.(?:xlsx?|csv|log|sql|dump)$/i,
  /zaruku/i,
  /medroche/i,
  /google-ads/i,
  /yandex-direct/i,
  /media-plan/i,
  /raw-client-id/i,
];

const SECRET_CONTENT = [
  /METRIKA_TOKEN\s*=/i,
  /DASHBOARD_AUTH_SECRET\s*=/i,
  /(?:^|[^A-Z_])DB_PASSWORD\s*=/i,
  /ABBOTT_PRIVATE_DB_PASSWORD\s*=/i,
  /(?:VIEWER_(?:JWT|TOKEN|QUERY_TOKEN)|QUERY_TOKEN|ACCESS_TOKEN)\s*=/i,
  /Abbott-dashboard-visual-baseline-2026-09-14/i,
];
const BINARY_SUFFIX = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|node|dylib|so(?:\.\d+)*)$/i;
const MAX_TEXT_BYTES = 32 * 1024 * 1024;

function relativeName(root, absolute) {
  return path.relative(root, absolute).split(path.sep).join("/");
}

function pathIsForbidden(relative) {
  if (relative.startsWith("node_modules/")) {
    return FORBIDDEN_ABBOTT_ARTIFACT.slice(0, 4).some((pattern) => pattern.test(relative));
  }
  return FORBIDDEN_ABBOTT_ARTIFACT.some((pattern) => pattern.test(relative));
}

export function inspectAbbottArtifact(artifactRoot) {
  const root = path.resolve(artifactRoot);
  const violations = [];
  let scannedFiles = 0;
  let scannedTextFiles = 0;
  let rootStat;
  try {
    rootStat = fs.lstatSync(root);
  } catch {
    return { scannedFiles, scannedTextFiles, violations: ["missing artifact root"] };
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { scannedFiles, scannedTextFiles, violations: ["unsafe artifact root"] };
  }

  const visit = (absolute, depth = 0) => {
    const relative = relativeName(root, absolute);
    if (depth > 64) {
      violations.push(`excessive path depth: ${relative}`);
      return;
    }
    let stat;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      violations.push(`uninspectable entry: ${relative}`);
      return;
    }
    if (relative && pathIsForbidden(relative)) violations.push(`forbidden path: ${relative}`);
    if (stat.isSymbolicLink()) {
      violations.push(`symlink forbidden: ${relative}`);
      return;
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(absolute, name), depth + 1);
      return;
    }
    if (!stat.isFile()) {
      violations.push(`unsupported entry: ${relative}`);
      return;
    }
    scannedFiles += 1;
    if (relative.startsWith("node_modules/") || relative.endsWith(".test.ts") || relative.endsWith(".test.tsx") || BINARY_SUFFIX.test(relative)) return;
    if (stat.size > MAX_TEXT_BYTES) {
      violations.push(`oversized text file: ${relative}`);
      return;
    }
    try {
      const buffer = fs.readFileSync(absolute);
      if (buffer.includes(0)) return;
      const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      scannedTextFiles += 1;
      if (SECRET_CONTENT.some((pattern) => pattern.test(text))) violations.push(`secret marker: ${relative}`);
    } catch {
      violations.push(`uninspectable text file: ${relative}`);
    }
  };
  visit(root);
  return { scannedFiles, scannedTextFiles, violations: [...new Set(violations)].sort() };
}

export function assertAbbottArtifact(artifactRoot) {
  const result = inspectAbbottArtifact(artifactRoot);
  if (result.violations.length > 0) {
    throw new Error(`Rejected Abbott artifact:\n${result.violations.map((item) => `- ${item}`).join("\n")}`);
  }
  return result;
}

function main() {
  if (process.argv.length !== 3) throw new Error("usage: assert-abbott-artifact.mjs <artifact-root>");
  const result = assertAbbottArtifact(process.argv[2]);
  console.log(`Abbott artifact scan passed: ${result.scannedFiles} files, ${result.scannedTextFiles} text files`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
