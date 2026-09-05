import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ZARUKU_APP_ROOT = "apps/zaruku";
const ZARUKU_SERVER = `${ZARUKU_APP_ROOT}/server.js`;
const ZARUKU_NEXT_SERVER = `${ZARUKU_APP_ROOT}/.next-zaruku/server`;
const ZARUKU_ROUTE_MANIFEST = `${ZARUKU_NEXT_SERVER}/app-paths-manifest.json`;

const ZARUKU_ROUTES = new Map([
  ["/_global-error/page", "app/_global-error/page.js"],
  ["/_not-found/page", "app/_not-found/page.js"],
  ["/api/dashboard/zaruku/excel/route", "app/api/dashboard/zaruku/excel/route.js"],
  ["/api/dashboard/zaruku/pdf/route", "app/api/dashboard/zaruku/pdf/route.js"],
  ["/api/dashboard/zaruku/route", "app/api/dashboard/zaruku/route.js"],
  ["/api/health/route", "app/api/health/route.js"],
  ["/dashboard/zaruku/page", "app/dashboard/zaruku/page.js"],
]);
const ZARUKU_COMPILED_ROUTES = new Set(ZARUKU_ROUTES.values());

const FORBIDDEN_PATH_MARKERS = [
  "server/app/dashboard/abbott",
  "server/app/api/dashboard/abbott",
  "server/app/admin",
  "server/middleware.js",
  "abbott-private-store",
  "abbott-bi-loader",
  "advertising-binding-read-model",
];

const FORBIDDEN_CONTENT_MARKERS = [
  ...FORBIDDEN_PATH_MARKERS,
  "report_bd_private",
  "abbott_private_db_password",
  "api-metrika.yandex.net",
  "api.webmaster.yandex.net",
  "googleads.googleapis.com",
  "metrika_token",
  "yandex_direct_token",
];

const PRIVATE_KEYS = new Set([
  "raw_user_id",
  "raw_user_ids_json",
  "protected_visit_id",
  "visit_id",
  "source_event_id",
]);
const PRIVATE_KEY_SETS = [
  ["visit_id", "client_id", "start_url", "end_url"],
  ["session_id", "user_id", "page_url"],
  ["protected_visit_id", "event_sequence", "normalized_path"],
];
const SOURCE_EXPORT_SUFFIXES = new Set([".json", ".jsonl", ".csv", ".tsv"]);
const SOURCE_WORKBOOK_SUFFIXES = [".xlsx", ".xls"];
const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/;

function normalizedPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function isRegularFile(absolutePath) {
  try {
    return lstatSync(absolutePath).isFile();
  } catch {
    return false;
  }
}

function normalizeKey(value) {
  const trimmed = String(value).trim();
  const metrikaField = /^ym:s:(.+)$/i.exec(trimmed)?.[1];
  const unprefixed = metrikaField
    ? metrikaField.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    : trimmed;
  return unprefixed.toLowerCase().replace(/[\s-]+/g, "_");
}

function hasPrivateKeys(keys) {
  const normalized = new Set(Array.from(keys, normalizeKey));
  if ([...PRIVATE_KEYS].some((key) => normalized.has(key))) return true;
  return PRIVATE_KEY_SETS.some((required) => required.every((key) => normalized.has(key)));
}

function jsonHasPrivateStructure(value) {
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current && typeof current === "object") {
      const entries = Object.entries(current);
      if (hasPrivateKeys(entries.map(([key]) => key))) return true;
      pending.push(...entries.map(([, nested]) => nested));
    }
  }
  return false;
}

function hasPrivateSourceExport(absolutePath, relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (!SOURCE_EXPORT_SUFFIXES.has(extension)) return false;
  const text = readFileSync(absolutePath, "utf8");
  if (extension === ".json") return jsonHasPrivateStructure(JSON.parse(text));
  if (extension === ".jsonl") {
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .some((line) => jsonHasPrivateStructure(JSON.parse(line)));
  }
  const header = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = extension === ".tsv" ? "\t" : ",";
  return hasPrivateKeys(header.split(delimiter).map((key) => key.replace(/^\s*["']|["']\s*$/g, "")));
}

function fileHasForbiddenContent(absolutePath) {
  const lower = readFileSync(absolutePath).toString("utf8").toLowerCase();
  return FORBIDDEN_CONTENT_MARKERS.find((marker) => lower.includes(marker));
}

function inspectMetadata(root, scope, violations) {
  const sourceShaPath = path.join(root, ".release-source-sha");
  if (!isRegularFile(sourceShaPath)) {
    violations.push("missing regular metadata file .release-source-sha");
  } else {
    const sourceSha = readFileSync(sourceShaPath, "utf8").trim();
    if (!SOURCE_SHA_PATTERN.test(sourceSha)) violations.push("invalid .release-source-sha");
  }

  const scopePath = path.join(root, ".release-runtime-scope");
  if (!isRegularFile(scopePath)) {
    violations.push("missing regular metadata file .release-runtime-scope");
  } else if (readFileSync(scopePath, "utf8").trim() !== scope) {
    violations.push(`invalid .release-runtime-scope: expected ${scope}`);
  }
}

function inspectZarukuRoutes(root, violations) {
  const serverPath = path.join(root, ZARUKU_SERVER);
  if (!isRegularFile(serverPath)) violations.push(`missing regular standalone server ${ZARUKU_SERVER}`);

  const manifestPath = path.join(root, ZARUKU_ROUTE_MANIFEST);
  if (!isRegularFile(manifestPath)) {
    violations.push(`missing route manifest ${ZARUKU_ROUTE_MANIFEST}`);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    violations.push(`malformed route manifest ${ZARUKU_ROUTE_MANIFEST}`);
    return;
  }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== "object") {
    violations.push(`malformed route manifest ${ZARUKU_ROUTE_MANIFEST}`);
    return;
  }

  for (const [route, target] of ZARUKU_ROUTES) {
    if (manifest[route] !== target) {
      violations.push(`missing route ${route} -> ${target}`);
      continue;
    }
    const compiledRoute = path.join(root, ZARUKU_NEXT_SERVER, target);
    if (!isRegularFile(compiledRoute)) violations.push(`missing compiled route ${target}`);
  }
  for (const route of Object.keys(manifest)) {
    if (!ZARUKU_ROUTES.has(route)) violations.push(`unexpected route ${route}`);
  }
}

function inspectTree(root, violations) {
  const canonicalRoot = realpathSync(root);
  function visit(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      violations.push(`unreadable directory ${normalizedPath(root, directory) || "."}`);
      return;
    }

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = normalizedPath(root, absolutePath);
      const lowerPath = relativePath.toLowerCase();

      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = realpathSync(absolutePath);
        } catch {
          violations.push(`invalid symlink ${relativePath}`);
          continue;
        }
        if (!isWithin(canonicalRoot, target)) violations.push(`symlink escapes artifact root: ${relativePath}`);
        continue;
      }
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        violations.push(`unsupported artifact entry ${relativePath}`);
        continue;
      }

      const pathMarker = FORBIDDEN_PATH_MARKERS.find((marker) => lowerPath.includes(marker));
      if (pathMarker) violations.push(`forbidden path marker ${pathMarker}: ${relativePath}`);
      const basename = path.posix.basename(lowerPath);
      if (basename.startsWith(".env") && relativePath !== ".env") {
        violations.push(`unapproved environment file ${relativePath}`);
      }
      if (SOURCE_WORKBOOK_SUFFIXES.some((suffix) => lowerPath.endsWith(suffix))) {
        violations.push(`source workbook ${relativePath}`);
      }
      if (
        lowerPath.startsWith(`${ZARUKU_NEXT_SERVER}/app/`) &&
        /\/(?:page|route)\.js$/.test(lowerPath)
      ) {
        const compiledRoute = relativePath.slice(`${ZARUKU_NEXT_SERVER}/`.length);
        if (!ZARUKU_COMPILED_ROUTES.has(compiledRoute)) {
          violations.push(`unexpected compiled route ${compiledRoute}`);
        }
      }

      try {
        const contentMarker = fileHasForbiddenContent(absolutePath);
        if (contentMarker) violations.push(`forbidden content marker ${contentMarker}: ${relativePath}`);
        if (hasPrivateSourceExport(absolutePath, relativePath)) {
          violations.push(`private source export ${relativePath}`);
        }
      } catch {
        violations.push(`uninspectable artifact file ${relativePath}`);
      }
    }
  }

  visit(root);
}

export function inspectRuntimeArtifact(artifactRoot, scope) {
  const root = path.resolve(artifactRoot);
  const violations = [];
  if (scope !== "zaruku") return [`unsupported runtime scope ${scope}`];

  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    return [`missing artifact root ${root}`];
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return [`artifact root must be a real directory: ${root}`];
  }

  inspectMetadata(root, scope, violations);
  inspectZarukuRoutes(root, violations);
  inspectTree(root, violations);
  return [...new Set(violations)].sort((left, right) => left.localeCompare(right, "en"));
}

export function assertRuntimeArtifact(artifactRoot, scope) {
  const violations = inspectRuntimeArtifact(artifactRoot, scope);
  if (violations.length > 0) {
    throw new Error(`Rejected ${scope} runtime artifact:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  }
}

function removeMonorepoPackageMetadata(root) {
  const packagePath = path.join(root, "package.json");
  if (!isRegularFile(packagePath)) return;
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const runtimePackageJson = { ...packageJson };
  delete runtimePackageJson.scripts;
  delete runtimePackageJson.workspaces;
  delete runtimePackageJson.devDependencies;
  writeFileSync(packagePath, `${JSON.stringify(runtimePackageJson, null, 2)}\n`);
}

export function stampRuntimeArtifact(artifactRoot, scope, sourceSha) {
  if (scope !== "zaruku") throw new Error(`unsupported runtime scope ${scope}`);
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) throw new Error("source SHA must be exactly 40 lowercase hex characters");
  const root = path.resolve(artifactRoot);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("artifact root must be a real directory");
  if (!isRegularFile(path.join(root, ZARUKU_SERVER))) throw new Error(`missing ${ZARUKU_SERVER}`);
  removeMonorepoPackageMetadata(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, ".release-source-sha"), `${sourceSha}\n`, { flag: "wx" });
  writeFileSync(path.join(root, ".release-runtime-scope"), `${scope}\n`, { flag: "wx" });
}

function usage() {
  return "usage: runtime-artifact-policy.mjs [--stamp] zaruku <artifact-root>";
}

function main() {
  const args = process.argv.slice(2);
  const stamp = args[0] === "--stamp";
  const positional = stamp ? args.slice(1) : args;
  if (positional.length !== 2) throw new Error(usage());
  const [scope, artifactRoot] = positional;
  if (stamp) {
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    stampRuntimeArtifact(artifactRoot, scope, sourceSha);
  } else {
    assertRuntimeArtifact(artifactRoot, scope);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
