import { readdirSync } from "node:fs";
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

function isProhibitedAbbottAsset(relativePath: string) {
  const normalized = relativePath.split(path.sep).join("/").toLowerCase();
  return normalized.includes("abbott") && PROHIBITED_SOURCE_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

function scanTree(root: string, isProhibited: (relativePath: string) => boolean): string[] {
  const matches: string[] = [];

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
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile()) {
        const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
        if (isProhibited(relativePath)) matches.push(relativePath);
      }
    }
  }

  visit(root);
  return matches.sort();
}

export function findPrivatePublicAssets(publicRoot: string): string[] {
  return scanTree(publicRoot, isProhibitedAbbottAsset);
}

export function findPrivateReleaseAssets(releaseRoot: string): string[] {
  return scanTree(releaseRoot, (relativePath) => {
    const normalized = relativePath.toLowerCase();
    if (normalized.startsWith("src/db/migrations/") && normalized.endsWith(".sql")) return false;
    return isProhibitedAbbottAsset(relativePath);
  });
}
