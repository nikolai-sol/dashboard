import { lstatSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";

const PROHIBITED_SOURCE_SUFFIXES = [
  ".json",
  ".xlsx",
  ".xls",
  ".csv",
  ".sql",
  ".zip",
  ".tar",
  ".tar.gz",
  ".tgz",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
] as const;

const SAFE_ABBOTT_MIGRATIONS = new Set([
  "src/db/migrations/019_dashboard_abbott_bi_type.sql",
  "src/db/migrations/033_abbott_canonical_release_control.sql",
]);

function isProhibitedAbbottAsset(relativePath: string) {
  const normalized = relativePath.split(path.sep).join("/").toLowerCase();
  return normalized.includes("abbott") && PROHIBITED_SOURCE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function normalizedRelativePath(root: string, absolutePath: string) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function isAllowedGeneratedReleaseSymlink(root: string, absolutePath: string, relativePath: string) {
  const match = /^\.next\/node_modules\/(rimraf|puppeteer)-[a-f0-9]+$/.exec(relativePath);
  if (!match) return false;
  const target = path.resolve(path.dirname(absolutePath), readlinkSync(absolutePath));
  return normalizedRelativePath(root, target) === `node_modules/${match[1]}`;
}

function scanTree(
  root: string,
  isProhibited: (relativePath: string) => boolean,
  isAllowedSymlink: (absolutePath: string, relativePath: string) => boolean = () => false,
): string[] {
  const matches: string[] = [];

  try {
    if (lstatSync(root).isSymbolicLink()) return ["."];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  function visit(directory: string) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizedRelativePath(root, absolutePath);
      if (entry.isSymbolicLink()) {
        if (!isAllowedSymlink(absolutePath, relativePath)) matches.push(relativePath);
      } else if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        if (isProhibited(relativePath)) matches.push(relativePath);
      }
    }
  }

  visit(root);
  return matches.sort();
}

export function findForbiddenPublicAssets(publicRoot: string): string[] {
  return scanTree(publicRoot, isProhibitedAbbottAsset);
}

export function findPrivateReleaseAssets(releaseRoot: string): string[] {
  return scanTree(
    releaseRoot,
    (relativePath) => {
      if (SAFE_ABBOTT_MIGRATIONS.has(relativePath)) return false;
      return isProhibitedAbbottAsset(relativePath);
    },
    (absolutePath, relativePath) => isAllowedGeneratedReleaseSymlink(releaseRoot, absolutePath, relativePath),
  );
}
