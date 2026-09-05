import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ZARUKU_APP_ROOT = "apps/zaruku";
const ZARUKU_SERVER = `${ZARUKU_APP_ROOT}/server.js`;
const ZARUKU_NEXT = `${ZARUKU_APP_ROOT}/.next-zaruku`;
const ZARUKU_NEXT_SERVER = `${ZARUKU_APP_ROOT}/.next-zaruku/server`;
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_AUTHORITY_FILES = [
  "routes-manifest.json", "server/pages-manifest.json", "build-manifest.json", "prerender-manifest.json",
  "server/functions-config-manifest.json", "server/middleware-manifest.json", "server/middleware-build-manifest.js",
  "server/middleware-react-loadable-manifest.js", "react-loadable-manifest.json", "server/app-paths-manifest.json",
  "app-path-routes-manifest.json", "server/server-reference-manifest.js", "server/server-reference-manifest.json",
  "BUILD_ID", "server/next-font-manifest.js", "server/next-font-manifest.json", "required-server-files.json",
];

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
  "abbott_private_db_",
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
const OPAQUE_SUFFIX = /\.(?:xlsx?|xlsm|xlsb|xltx?|xltm|xlam|ods|ots|fods|numbers|zip|tar(?:\..*)?|tgz|tbz2?|txz|gz|bz2|xz|zst|7z|rar|jar|war|iso|dmg)$/i;
const SOURCE_SHA_PATTERN = /^[a-f0-9]{40}$/;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 256 * 1024 * 1024;
const ZARUKU_ENV_KEYS = new Set([
  "DB_HOST", "DB_PORT", "DB_USER", "DB_PASSWORD", "DB_NAME",
  "MYSQL_HOST", "MYSQL_PORT", "MYSQL_USER", "MYSQL_PASSWORD", "MYSQL_DB",
  "NODE_ENV", "HOSTNAME", "PORT", "NEXT_PUBLIC_BASE_URL", "DASHBOARD_AUTH_SECRET",
  "INTERNAL_BASE_URL", "PUPPETEER_EXECUTABLE_PATH",
]);
const ASSET_REWRITE = {
  source: "/_next-zaruku/_next/:path+", destination: "/_next/:path+",
  regex: "^/_next-zaruku/_next(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))(?:/)?$",
};
const SLASH_REDIRECT = {
  source: "/:path+/", destination: "/:path+", internal: true, priority: true,
  statusCode: 308, regex: "^(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))/$",
};
// Pinned Next 16.1.6 standalone entrypoint, with only its JSON config variable.
// Matching the entire executable prevents comments or token-shaped fake servers.
const STANDALONE_TEMPLATE = `const path = require('path')
const dir = path.join(__dirname)
process.env.NODE_ENV = 'production'
process.chdir(__dirname)
const currentPort = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'
let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
const nextConfig = {}
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(nextConfig)
require('next')
const { startServer } = require('next/dist/server/lib/start-server')
if (
  Number.isNaN(keepAliveTimeout) ||
  !Number.isFinite(keepAliveTimeout) ||
  keepAliveTimeout < 0
) {
  keepAliveTimeout = undefined
}
startServer({
  dir,
  isDev: false,
  config: nextConfig,
  hostname,
  port: currentPort,
  allowRetry: false,
  keepAliveTimeout,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});`;

function normalizedPath(root, absolutePath) {
  return path.relative(root, absolutePath).split(path.sep).join("/");
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

function hasPrivateSourceExport(text, relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (!SOURCE_EXPORT_SUFFIXES.has(extension)) return false;
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

function inspectMetadata(files, scope, violations) {
  if (!files.has(".release-source-sha")) {
    violations.push("missing regular metadata file .release-source-sha");
  } else {
    const sourceSha = files.get(".release-source-sha").text;
    if (!/^[a-f0-9]{40}\n$/.test(sourceSha)) violations.push("invalid .release-source-sha");
  }

  if (!files.has(".release-runtime-scope")) {
    violations.push("missing regular metadata file .release-runtime-scope");
  } else if (files.get(".release-runtime-scope").text !== `${scope}\n`) {
    violations.push(`invalid .release-runtime-scope: expected ${scope}`);
  }
}

function inspectZarukuRoutes(files, violations) {
  const json = (name) => {
    const filename = `${ZARUKU_NEXT}/${name}`;
    try { return JSON.parse(files.get(filename).text); }
    catch { violations.push(`missing or malformed authority ${filename}`); return null; }
  };
  const check = (name, predicate) => {
    const value = json(name);
    try { if (value === null || !predicate(value)) violations.push(`invalid route authority ${ZARUKU_NEXT}/${name}`); }
    catch { violations.push(`invalid route authority ${ZARUKU_NEXT}/${name}`); }
    return value;
  };
  const manifest = json("server/app-paths-manifest.json") ?? {};
  for (const [route, target] of ZARUKU_ROUTES) {
    if (manifest[route] !== target) {
      violations.push(`missing route ${route} -> ${target}`);
      continue;
    }
    if (!files.has(`${ZARUKU_NEXT_SERVER}/${target}`)) violations.push(`missing compiled route ${target}`);
  }
  for (const route of Object.keys(manifest)) {
    if (!ZARUKU_ROUTES.has(route)) violations.push(`unexpected route ${route}`);
  }
  check("server/middleware-manifest.json", (v) => isDeepStrictEqual(v, { version: 3, middleware: {}, functions: {}, sortedMiddleware: [] }));
  check("server/pages-manifest.json", (v) => isDeepStrictEqual(v, { "/404": "pages/404.html", "/500": "pages/500.html" }));
  check("server/functions-config-manifest.json", (v) => isDeepStrictEqual(v, { version: 1, functions: {} }));
  check("server/server-reference-manifest.json", (v) => isDeepStrictEqual(v.node, {}) && isDeepStrictEqual(v.edge, {}));
  check("build-manifest.json", (v) => isDeepStrictEqual(v.pages, { "/_app": [] }) && isDeepStrictEqual(v.rootMainFilesTree, {}) && isDeepStrictEqual(v.devFiles, []));
  const routePaths = [...ZARUKU_ROUTES.keys()].map((route) => route.replace(/\/(page|route)$/, ""));
  check("app-path-routes-manifest.json", (v) => isDeepStrictEqual(v, Object.fromEntries([...ZARUKU_ROUTES.keys()].map((route, i) => [route, routePaths[i]]))));
  check("routes-manifest.json", (v) => v.version === 3 && v.appType === "app" && v.basePath === "" &&
    isDeepStrictEqual(v.redirects, [SLASH_REDIRECT]) && isDeepStrictEqual(v.headers, []) &&
    isDeepStrictEqual(v.rewrites, { beforeFiles: [ASSET_REWRITE], afterFiles: [], fallback: [] }) &&
    isDeepStrictEqual(v.dynamicRoutes, []) && isDeepStrictEqual(v.dataRoutes, []) &&
    isDeepStrictEqual(v.staticRoutes, routePaths.sort().map((page) => {
      const regex = `^${page.replace(/-/g, "\\-")}(?:/)?$`;
      return { page, regex, routeKeys: {}, namedRegex: regex };
    })));
  check("prerender-manifest.json", (v) => v.version === 4 && isDeepStrictEqual(Object.keys(v.routes).sort(), ["/_global-error", "/_not-found"]) &&
    isDeepStrictEqual(v.dynamicRoutes, {}) && isDeepStrictEqual(v.notFoundRoutes, []) &&
    Object.entries(v.routes).every(([route, entry]) => entry.srcRoute === route && entry.dataRoute === `${route}.rsc`));
  const required = check("required-server-files.json", (v) => v.version === 1 && v.relativeAppDir === ZARUKU_APP_ROOT &&
    v.config.output === "standalone" && v.config.distDir === ".next-zaruku" && v.config.assetPrefix === "/_next-zaruku" &&
    v.config.basePath === "" && !v.config.i18n && isDeepStrictEqual(v.config.env, {}) &&
    !v.config.rewrites && !v.config.redirects && !v.config.headers &&
    Array.isArray(v.files) && v.files.length > 0 && v.files.every((file) => typeof file === "string" &&
      file.startsWith(".next-zaruku/") && !file.split("/").includes("..") && files.has(`${ZARUKU_APP_ROOT}/${file}`)));
  if (!files.get(`${ZARUKU_NEXT}/BUILD_ID`)?.text?.match(/^[\w-]+$/)) violations.push(`invalid ${ZARUKU_NEXT}/BUILD_ID`);
  try {
    const source = files.get(ZARUKU_SERVER).text;
    const match = /^const nextConfig = (.+)$/m.exec(source);
    const config = JSON.parse(match[1]);
    const normalized = (text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join("\n");
    if (normalized(source.replace(match[0], "const nextConfig = {}")) !== normalized(STANDALONE_TEMPLATE) ||
      !isDeepStrictEqual({ ...config, distDir: ".next-zaruku" }, required.config) || config.distDir !== "./.next-zaruku") throw new Error();
  } catch { violations.push(`invalid standalone server ${ZARUKU_SERVER}`); }
}

function inspectFileClosure(files, violations, { rejectUntraced = true } = {}) {
  const allowed = new Set();
  const visiting = new Set();
  const visited = new Set();
  let references = 0;
  const include = (name, depth = 0) => {
    if (!files.has(name)) { violations.push(`missing traced file ${name}`); return; }
    allowed.add(name);
    if (!name.endsWith(".nft.json")) {
      if (files.has(`${name}.nft.json`)) include(`${name}.nft.json`, depth + 1);
      return;
    }
    if (visiting.has(name)) { violations.push(`cyclic trace ${name}`); return; }
    if (visited.has(name)) return;
    try {
      if (depth > 32) throw new Error();
      const trace = JSON.parse(files.get(name).text);
      if (!isDeepStrictEqual(Object.keys(trace).sort(), ["files", "version"]) || trace.version !== 1 ||
        !Array.isArray(trace.files) || trace.files.length > 10000 || new Set(trace.files).size !== trace.files.length) throw new Error();
      visiting.add(name);
      for (const entry of trace.files) {
        if (++references > 20000 || typeof entry !== "string" || !entry || /[\\\u0000-\u001f:]/.test(entry) || path.posix.isAbsolute(entry)) throw new Error();
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), entry));
        if (target === ".." || target.startsWith("../") || target === ".") throw new Error();
        include(target, depth + 1);
      }
      visited.add(name);
    } catch { violations.push(`invalid or excessive trace ${name}`); }
    finally { visiting.delete(name); }
  };
  for (const name of [".release-source-sha", ".release-runtime-scope", "package.json", ZARUKU_SERVER,
    `${ZARUKU_APP_ROOT}/package.json`, `${ZARUKU_NEXT}/package.json`, `${ZARUKU_NEXT}/next-server.js.nft.json`,
    ...NEXT_AUTHORITY_FILES.map((name) => `${ZARUKU_NEXT}/${name}`)]) include(name);
  if (files.has(".env")) include(".env");
  for (const target of ZARUKU_COMPILED_ROUTES) {
    include(`${ZARUKU_NEXT_SERVER}/${target}`);
    include(`${ZARUKU_NEXT_SERVER}/${target}.nft.json`);
  }

  // These inert framework outputs have exact names and cannot authorize helpers.
  for (const route of ["_global-error", "_not-found"]) {
    const stem = `${ZARUKU_NEXT_SERVER}/app/${route}`;
    for (const ext of ["html", "meta", "rsc"]) if (files.has(`${stem}.${ext}`)) include(`${stem}.${ext}`);
    for (const segment of ["_tree", "_full", `${route}/__PAGE__`, route, "_index", "_head"]) {
      const filename = `${stem}.segments/${segment}.segment.rsc`;
      if (files.has(filename)) include(filename);
    }
  }
  for (const code of [404, 500]) {
    const filename = `${ZARUKU_NEXT_SERVER}/pages/${code}.html`;
    if (files.has(filename)) include(filename);
  }

  // Optional browser output may be copied into standalone later. Only concrete
  // assets named by the owned build/client/font manifests enter the closure.
  const buildId = files.get(`${ZARUKU_NEXT}/BUILD_ID`)?.text;
  const staticName = (name) => /^static\/(?:chunks\/(?:[\w-]+\/)*[\w.-]+\.js|css\/[\w.-]+\.css|media\/[\w.-]+\.(?:woff2?|ttf|otf|png|jpe?g|gif|webp|avif|ico|svg))$/.test(name) ||
    name === `static/${buildId}/_buildManifest.js` || name === `static/${buildId}/_ssgManifest.js`;
  const addAssets = (value) => {
    if (typeof value === "string" && value.startsWith("static/")) {
      if (!staticName(value)) throw new Error();
      if (files.has(`${ZARUKU_NEXT}/${value}`)) include(`${ZARUKU_NEXT}/${value}`);
    } else if (Array.isArray(value)) value.forEach(addAssets);
    else if (value && typeof value === "object") Object.values(value).forEach(addAssets);
  };
  for (const name of ["build-manifest.json", "react-loadable-manifest.json", "server/next-font-manifest.json"]) {
    try { addAssets(JSON.parse(files.get(`${ZARUKU_NEXT}/${name}`).text)); }
    catch { violations.push(`invalid asset authority ${ZARUKU_NEXT}/${name}`); }
  }
  for (const [route, target] of ZARUKU_ROUTES) {
    const name = `${ZARUKU_NEXT_SERVER}/${target.replace(/\.js$/, "_client-reference-manifest.js")}`;
    if (!allowed.has(name)) continue;
    try {
      const prefix = `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});globalThis.__RSC_MANIFEST[${JSON.stringify(route)}]=`;
      const text = files.get(name).text.trim();
      if (!text.startsWith(prefix)) throw new Error();
      addAssets(JSON.parse(text.slice(prefix.length).replace(/;$/, "")));
    } catch { violations.push(`invalid client asset authority ${name}`); }
  }

  let lock;
  try { lock = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "package-lock.json"), "utf8")).packages; }
  catch { violations.push("missing reviewed package lock authority"); }
  for (const name of allowed) {
    if (name.startsWith("node_modules/")) {
      const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)/.exec(name);
      if (!allowed.has(`${match[1]}/package.json`)) violations.push(`missing traced package identity ${match[1]}/package.json`);
    }
    if (name.startsWith("packages/runtime-contract/") && !allowed.has("packages/runtime-contract/package.json")) violations.push("missing traced package identity packages/runtime-contract/package.json");
    if (path.posix.basename(name) !== "package.json") continue;
    try {
      const actual = JSON.parse(files.get(name).text);
      let expected;
      if (name === `${ZARUKU_NEXT}/package.json`) expected = { type: "commonjs" };
      else {
        expected = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, name), "utf8"));
        if (name === "package.json") for (const key of ["scripts", "workspaces", "devDependencies"]) delete expected[key];
      }
      if (!isDeepStrictEqual(actual, expected)) throw new Error();
      const entry = lock?.[path.posix.dirname(name)];
      if (entry?.version && actual.version !== entry.version) throw new Error();
      if (name === "node_modules/next/package.json" && (actual.name !== "next" || actual.version !== "16.1.6")) throw new Error();
      if (name === "packages/runtime-contract/package.json" && (actual.name !== "@reportingdash/runtime-contract" || actual.version !== "0.1.0")) throw new Error();
    } catch { violations.push(`invalid traced package identity ${name}`); }
  }
  if (rejectUntraced) for (const name of files.keys()) if (!allowed.has(name)) violations.push(`untraced artifact file ${name}`);
  return allowed;
}

function readStableFile(filename, { metadata = false } = {}) {
  const before = fs.lstatSync(filename, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(metadata ? 8 * 1024 * 1024 : MAX_FILE_BYTES) ||
    metadata && (Number(before.mode) & 0o077 || Number(before.uid) !== process.getuid())) throw new Error("unsafe regular file");
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    if (!sameEntry(before, fs.fstatSync(fd, { bigint: true }))) throw new Error("file changed");
    const buffer = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < buffer.length) {
      const n = fs.readSync(fd, buffer, offset, buffer.length - offset, offset);
      if (!n) throw new Error("file shortened");
      offset += n;
    }
    if (!sameEntry(before, fs.fstatSync(fd, { bigint: true })) || !sameEntry(before, fs.lstatSync(filename, { bigint: true }))) throw new Error("file changed");
    return { buffer, mode: Number(before.mode) & 0o777 };
  } finally { fs.closeSync(fd); }
}

function loadTrustedManifest(root, filename) {
  if (typeof filename !== "string" || !filename) throw new Error("explicit trusted manifest path is required");
  const canonicalRoot = fs.realpathSync(root);
  const manifestPath = path.resolve(filename);
  for (const candidate of [manifestPath, `${manifestPath}.sha256`]) {
    for (let parent = path.dirname(candidate); parent !== path.dirname(parent); parent = path.dirname(parent)) {
      const stat = fs.lstatSync(parent);
      const systemAlias = ["/var", "/tmp"].includes(parent) && fs.realpathSync(parent) === `/private${parent}`;
      if (!stat.isDirectory() && !(stat.isSymbolicLink() && systemAlias)) throw new Error("unsafe trusted metadata directory");
    }
    const real = fs.realpathSync(candidate);
    const relative = path.relative(canonicalRoot, real);
    if (!relative || !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)) throw new Error("trusted manifest must be outside artifact");
  }
  const bytes = readStableFile(manifestPath, { metadata: true }).buffer;
  const expected = decodeUtf8(readStableFile(`${manifestPath}.sha256`, { metadata: true }).buffer);
  if (!/^[a-f0-9]{64}\n$/.test(expected) || createHash("sha256").update(bytes).digest("hex") !== expected.trim()) throw new Error("trusted manifest digest mismatch");
  const value = JSON.parse(decodeUtf8(bytes));
  if (value.version !== 1 || value.scope !== "zaruku" || !SOURCE_SHA_PATTERN.test(value.sourceSha) ||
    !isDeepStrictEqual(value.next, { name: "next", version: "16.1.6" }) ||
    !isDeepStrictEqual(value.runtimeContract, { name: "@reportingdash/runtime-contract", version: "0.1.0" }) ||
    !isDeepStrictEqual(value.dynamic, [{ path: ".env", type: "dynamic", policy: "zaruku-env-v1", required: false }]) ||
    !Array.isArray(value.files) || !value.files.length || value.files.length > 20000) throw new Error("invalid trusted manifest authority");
  const entries = new Map();
  for (const entry of value.files) {
    if (!entry || typeof entry.path !== "string" || !entry.path || entry.path === ".env" ||
      path.posix.normalize(entry.path) !== entry.path || entry.path.startsWith("../") || entry.path.startsWith("/") || /[\\\u0000-\u001f:]/.test(entry.path) ||
      entries.has(entry.path) || entry.type !== "file" || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777 ||
      !Number.isInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(entry.sha256) || typeof entry.required !== "boolean" ||
      !entry.required && !entry.path.startsWith(`${ZARUKU_NEXT}/static/`)) throw new Error("invalid trusted file entry");
    entries.set(entry.path, entry);
  }
  return { ...value, entries, manifestDigest: expected.trim() };
}

function verifyTrustedFiles(files, trusted, violations) {
  for (const [name, file] of files) {
    if (name === ".env") continue;
    const expected = trusted.entries.get(name);
    if (!expected || expected.sha256 !== file.digest || expected.size !== file.size || expected.mode !== file.mode) violations.push(`trusted file mismatch ${name}`);
  }
  for (const [name, entry] of trusted.entries) if (entry.required && !files.has(name)) violations.push(`missing trusted file ${name}`);
  if (files.get(".release-source-sha")?.text !== `${trusted.sourceSha}\n`) violations.push("trusted source SHA mismatch .release-source-sha");
  if (files.get(".release-runtime-scope")?.text !== `${trusted.scope}\n`) violations.push("trusted scope mismatch .release-runtime-scope");
}

const BINARY_STATIC = /\/static\/media\/[\w.-]+\.(?:woff2?|ttf|otf|png|jpe?g|gif|webp|avif|ico)$/;

export function createTrustedRuntimeManifest(artifactRoot, scope, sourceSha, manifestPath) {
  const root = path.resolve(artifactRoot);
  const buildRoot = path.dirname(root);
  if (scope !== "zaruku" || !SOURCE_SHA_PATTERN.test(sourceSha) || buildRoot !== path.join(REPOSITORY_ROOT, ZARUKU_NEXT)) throw new Error("invalid trusted build source");
  if (path.resolve(manifestPath).startsWith(`${root}${path.sep}`)) throw new Error("trusted manifest must be outside artifact");
  const files = new Map();
  let totalBytes = 0;
  const put = (name, buffer, mode = 0o644) => {
    totalBytes += buffer.length - (files.get(name)?.size ?? 0);
    if (totalBytes > MAX_ARTIFACT_BYTES) throw new Error("trusted build exceeds size limit");
    const binary = BINARY_STATIC.test(name) || name.startsWith("node_modules/") && /\.(?:node|dylib|so(?:\.\d+)*)$/.test(name);
    const text = binary ? buffer.toString("latin1") : decodeUtf8(buffer);
    files.set(name, { text, size: buffer.length, mode, digest: createHash("sha256").update(buffer).digest("hex") });
  };
  const load = (name, optional = false, depth = 0) => {
    if (files.has(name)) return;
    if (depth > 32 || files.size >= 20000 || path.posix.normalize(name) !== name || name.startsWith("../") || path.isAbsolute(name) || /[\\\u0000-\u001f:]/.test(name)) throw new Error("unsafe build trace path");
    if (path.posix.basename(name).startsWith(".env")) throw new Error("runtime environment must not be a traced build input");
    const absolute = path.join(REPOSITORY_ROOT, name);
    if (optional && !fs.existsSync(absolute)) return;
    const actual = fs.realpathSync(absolute);
    const artifact = fs.realpathSync(root);
    if (actual === artifact || actual.startsWith(`${artifact}${path.sep}`)) throw new Error("artifact cannot supply trusted build bytes");
    const { buffer, mode } = readStableFile(absolute);
    put(name, buffer, mode);
    if (name.endsWith(".nft.json")) {
      const trace = JSON.parse(files.get(name).text);
      if (trace.version !== 1 || !Array.isArray(trace.files) || trace.files.length > 10000) throw new Error("invalid build trace");
      for (const entry of trace.files) {
        if (typeof entry !== "string" || path.posix.isAbsolute(entry) || /[\\\u0000-\u001f:]/.test(entry)) throw new Error("unsafe build trace");
        load(path.posix.normalize(path.posix.join(path.posix.dirname(name), entry)), false, depth + 1);
      }
    } else if (fs.existsSync(`${absolute}.nft.json`)) load(`${name}.nft.json`, false, depth + 1);
  };
  for (const name of ["package.json", `${ZARUKU_APP_ROOT}/package.json`, `${ZARUKU_NEXT}/package.json`,
    `${ZARUKU_NEXT}/next-server.js.nft.json`, ...NEXT_AUTHORITY_FILES.map((name) => `${ZARUKU_NEXT}/${name}`)]) load(name);
  const rootPackage = JSON.parse(files.get("package.json").text);
  for (const key of ["scripts", "workspaces", "devDependencies"]) delete rootPackage[key];
  put("package.json", Buffer.from(`${JSON.stringify(rootPackage, null, 2)}\n`));
  const config = JSON.parse(files.get(`${ZARUKU_NEXT}/required-server-files.json`).text).config;
  const starts = ["const dir", "process.env.NODE_ENV", "const currentPort", "let keepAliveTimeout", "process.env.__NEXT", "require('next')", "if (", "startServer("];
  const server = STANDALONE_TEMPLATE.split("\n").map((line) => starts.some((start) => line.startsWith(start)) ? `\n${line}` : line).join("\n")
    .replace("const nextConfig = {}", `const nextConfig = ${JSON.stringify({ ...config, distDir: "./.next-zaruku" })}`);
  put(ZARUKU_SERVER, Buffer.from(server));
  put(".release-source-sha", Buffer.from(`${sourceSha}\n`));
  put(".release-runtime-scope", Buffer.from(`${scope}\n`));
  for (const target of ZARUKU_COMPILED_ROUTES) { load(`${ZARUKU_NEXT_SERVER}/${target}`); load(`${ZARUKU_NEXT_SERVER}/${target}.nft.json`); }
  for (const route of ["_global-error", "_not-found"]) {
    const stem = `${ZARUKU_NEXT_SERVER}/app/${route}`;
    for (const ext of ["html", "meta", "rsc"]) load(`${stem}.${ext}`, true);
    for (const segment of ["_tree", "_full", `${route}/__PAGE__`, route, "_index", "_head"]) load(`${stem}.segments/${segment}.segment.rsc`, true);
  }
  for (const code of [404, 500]) load(`${ZARUKU_NEXT_SERVER}/pages/${code}.html`, true);
  const loadStatic = (directory, depth = 0) => {
    if (depth > 64) throw new Error("excessive static directory depth");
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name), stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) loadStatic(absolute, depth + 1);
      else load(normalizedPath(REPOSITORY_ROOT, absolute));
    }
  };
  loadStatic(path.join(buildRoot, "static"));
  const violations = [];
  inspectMetadata(files, scope, violations);
  inspectZarukuRoutes(files, violations);
  const allowed = inspectFileClosure(files, violations, { rejectUntraced: false });
  if (violations.length) throw new Error(`invalid trusted build closure:\n${violations.join("\n")}`);
  const manifest = { version: 1, scope, sourceSha, next: { name: "next", version: "16.1.6" },
    runtimeContract: { name: "@reportingdash/runtime-contract", version: "0.1.0" },
    dynamic: [{ path: ".env", type: "dynamic", policy: "zaruku-env-v1", required: false }],
    files: [...allowed].sort().map((name) => { const file = files.get(name); return { path: name, type: "file", mode: file.mode, size: file.size,
      sha256: file.digest, required: !name.startsWith(`${ZARUKU_NEXT}/static/`) }; }),
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(manifestPath, bytes, { mode: 0o600, flag: "wx" });
  writeFileSync(`${manifestPath}.sha256`, `${createHash("sha256").update(bytes).digest("hex")}\n`, { mode: 0o600, flag: "wx" });
}

function inspectPath(relativePath, violations) {
  const lower = relativePath.toLowerCase();
  const basename = path.posix.basename(lower);
  const marker = FORBIDDEN_PATH_MARKERS.find((item) => lower.includes(item));
  if (marker) violations.push(`forbidden path marker ${marker}: ${relativePath}`);
  if (basename.startsWith(".env") && relativePath !== ".env") violations.push(`unapproved environment file ${relativePath}`);
  if (OPAQUE_SUFFIX.test(lower)) violations.push(`opaque archive or source workbook ${relativePath}`);
  // Only traced dependencies, the one app, and scope metadata belong in this artifact.
  if (!/^(?:node_modules(?:\/|$)|apps(?:\/zaruku(?:\/|$)|$)|packages(?:\/runtime-contract(?:\/|$)|$)|package\.json$|\.release-(?:source-sha|runtime-scope)$|\.env$)/.test(relativePath)) {
    violations.push(`unexpected artifact path ${relativePath}`);
  }
  if (relativePath.startsWith(`${ZARUKU_APP_ROOT}/`) && ![
    ZARUKU_SERVER, `${ZARUKU_APP_ROOT}/package.json`, ZARUKU_NEXT,
  ].includes(relativePath) && !relativePath.startsWith(`${ZARUKU_NEXT}/`)) violations.push(`unexpected app file ${relativePath}`);
  if (relativePath.startsWith(`${ZARUKU_NEXT_SERVER}/`) && /\.(?:[cm]?js)$/.test(relativePath)) {
    const local = relativePath.slice(`${ZARUKU_NEXT_SERVER}/`.length);
    if (!local.startsWith("app/") && !/^chunks\/[^/]+\.js$/.test(local) && ![
      "webpack-runtime.js", "middleware-build-manifest.js", "middleware-react-loadable-manifest.js",
      "next-font-manifest.js", "server-reference-manifest.js",
    ].includes(local)) violations.push(`unexpected server executable ${relativePath}`);
  }
  if ((/\/(?:\.next[^/]*|server)\//.test(relativePath) && !relativePath.startsWith(`${ZARUKU_NEXT}/`) && !relativePath.startsWith("node_modules/")) ||
    (lower.startsWith(`${ZARUKU_NEXT_SERVER}/edge`) || lower.startsWith(`${ZARUKU_NEXT_SERVER}/pages/`) && !["404.html", "500.html"].includes(basename))) {
    violations.push(`foreign executable tree ${relativePath}`);
  }
  if (lower.startsWith(`${ZARUKU_NEXT_SERVER}/app/`) && /\/(?:page|route)\.js$/.test(lower)) {
    const route = relativePath.slice(`${ZARUKU_NEXT_SERVER}/`.length);
    if (!ZARUKU_COMPILED_ROUTES.has(route)) violations.push(`unexpected compiled route ${route}`);
  }
}

function decodeUtf8(buffer) {
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
  if (text.includes("\u0000") || text.includes("\ufeff")) throw new Error("unsupported text encoding");
  return text;
}

function inspectEnvironment(text) {
  if (Buffer.byteLength(text) > 65536 || !text.endsWith("\n") || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)) throw new Error("invalid environment");
  const keys = new Set();
  for (const line of text.split("\n")) {
    if (/^[\t ]*(?:#.*)?$/.test(line)) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(?:([^\s'"`#\\]*|'[^'\r\n]*'|"(?:[^"\\\r\n]|\\["\\nrt$])*"))$/.exec(line);
    if (!match || !ZARUKU_ENV_KEYS.has(match[1]) || keys.has(match[1])) throw new Error("invalid environment");
    keys.add(match[1]);
  }
}

function sameEntry(left, right) {
  return ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"].every((key) => left[key] === right[key]);
}

function archiveMagic(buffer) {
  const hex = buffer.subarray(0, 8).toString("hex");
  return /^(?:504b0304|504b0506|504b0708|1f8b|377abcaf271c|52617221|425a68|fd377a585a00|28b52ffd|d0cf11e0a1b11ae1)/.test(hex) ||
    buffer.subarray(257, 262).toString("ascii") === "ustar";
}

// Capture each file once through O_NOFOLLOW and an identity-checked descriptor.
// Authority checks consume these same bytes, then the complete tree identities
// are rechecked. Swaps, writes and parent-directory changes fail closed.
function inspectTree(root, violations, trusted) {
  const files = new Map();
  const identities = new Map();
  let totalBytes = 0;
  let entries = 0;
  function visit(absolutePath, depth = 0) {
    const relativePath = normalizedPath(root, absolutePath);
    if (relativePath) inspectPath(relativePath, violations);
    try {
      if (++entries > 20000 || depth > 64) throw new Error("artifact limits exceeded");
      const before = fs.lstatSync(absolutePath, { bigint: true });
      identities.set(absolutePath, before);
      if (before.isSymbolicLink()) {
        violations.push(`symlink forbidden (may escape artifact root): ${relativePath}`);
        return;
      }
      if (before.isDirectory()) {
        for (const name of fs.readdirSync(absolutePath).sort()) visit(path.join(absolutePath, name), depth + 1);
        return;
      }
      if (!before.isFile() || before.nlink !== 1n) throw new Error("unsupported entry");
      const size = Number(before.size);
      totalBytes += size;
      if (size > MAX_FILE_BYTES || totalBytes > MAX_ARTIFACT_BYTES || relativePath === ".env" && size > 65536) throw new Error("artifact limits exceeded");
      let buffer;
      const fd = fs.openSync(absolutePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        if (!sameEntry(before, fs.fstatSync(fd, { bigint: true }))) throw new Error("entry changed before read");
        buffer = Buffer.alloc(size);
        let offset = 0;
        while (offset < size) {
          const count = fs.readSync(fd, buffer, offset, size - offset, offset);
          if (!count) throw new Error("entry shortened during read");
          offset += count;
        }
        if (!sameEntry(before, fs.fstatSync(fd, { bigint: true }))) throw new Error("entry changed during read");
      } finally { fs.closeSync(fd); }
      const digest = createHash("sha256").update(buffer).digest("hex");
      const mode = Number(before.mode) & 0o777;
      const expected = trusted?.entries.get(relativePath);
      if (trusted && relativePath !== ".env" && (!expected || expected.sha256 !== digest || expected.mode !== mode || expected.size !== size)) {
        violations.push(`trusted file mismatch ${relativePath}`);
        return;
      }
      if (archiveMagic(buffer)) throw new Error("opaque container");
      // Binary browser assets are decoded only after their external hash matches.
      const binary = BINARY_STATIC.test(relativePath) || relativePath.startsWith("node_modules/") && /\.(?:node|dylib|so(?:\.\d+)*)$/.test(relativePath);
      const text = binary ? buffer.toString("latin1") : decodeUtf8(buffer);
      const contentMarker = FORBIDDEN_CONTENT_MARKERS.find((marker) => text.toLowerCase().includes(marker));
      if (contentMarker) violations.push(`forbidden content marker ${contentMarker}: ${relativePath}`);
      if (relativePath === ".env") inspectEnvironment(text);
      if (!binary && hasPrivateSourceExport(text, relativePath)) violations.push(`private source export ${relativePath}`);
      files.set(relativePath, { text, digest, size, mode });
    } catch { violations.push(`uninspectable artifact entry ${relativePath || "."}`); }
  }
  visit(root);
  for (const [absolutePath, before] of identities) {
    try {
      if (!sameEntry(before, fs.lstatSync(absolutePath, { bigint: true }))) throw new Error();
    } catch { violations.push(`artifact changed during inspection: ${normalizedPath(root, absolutePath) || "."}`); }
  }
  return files;
}

function inspectRuntimeArtifactState(artifactRoot, scope, trustedManifestPath) {
  const root = path.resolve(artifactRoot);
  const violations = [];
  const rejected = (message) => ({ files: new Map(), violations: [message] });
  if (scope !== "zaruku") return rejected(`unsupported runtime scope ${scope}`);

  let rootStat;
  try {
    rootStat = lstatSync(root);
  } catch {
    return rejected(`missing artifact root ${root}`);
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return rejected(`artifact root must be a real directory: ${root}`);
  }

  let trusted;
  try { trusted = loadTrustedManifest(root, trustedManifestPath); }
  catch { return rejected("missing, unsafe or invalid external trusted manifest authority"); }
  const files = inspectTree(root, violations, trusted);
  verifyTrustedFiles(files, trusted, violations);
  inspectMetadata(files, scope, violations);
  inspectZarukuRoutes(files, violations);
  inspectFileClosure(files, violations);
  return { files, violations: [...new Set(violations)].sort((left, right) => left.localeCompare(right, "en")) };
}

export function inspectRuntimeArtifact(artifactRoot, scope, trustedManifestPath) {
  return inspectRuntimeArtifactState(artifactRoot, scope, trustedManifestPath).violations;
}

export function assertRuntimeArtifact(artifactRoot, scope, trustedManifestPath) {
  const { files, violations } = inspectRuntimeArtifactState(artifactRoot, scope, trustedManifestPath);
  if (violations.length > 0) {
    throw new Error(`Rejected ${scope} runtime artifact:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  }
  return files;
}

export async function verifyRuntimeArtifactBoot(artifactRoot, scope, { timeoutMs = 15000, trustedManifestPath } = {}) {
  if (process.getuid?.() === 0 || process.geteuid?.() === 0) throw new Error("Direct runtime boot verification requires an unprivileged identity");
  const root = path.resolve(artifactRoot);
  const before = assertRuntimeArtifact(root, scope, trustedManifestPath);
  const authorityDigest = loadTrustedManifest(root, trustedManifestPath).manifestDigest;
  let child;
  let closed;
  try {
    const port = await new Promise((resolve, reject) => {
      const reservation = createServer();
      reservation.once("error", reject);
      reservation.listen(0, "127.0.0.1", () => {
        const port = reservation.address().port;
        reservation.close((error) => error ? reject(error) : resolve(port));
      });
    });
    // Deliberately supply no inherited credentials or Node preload options.
    child = spawn(process.execPath, [path.join(root, ZARUKU_SERVER)], {
      cwd: root,
      env: { NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), NEXT_TELEMETRY_DISABLED: "1" },
      stdio: "ignore",
    });
    let childError = false;
    child.once("error", () => { childError = true; });
    closed = new Promise((resolve) => child.once("close", resolve));
    const deadline = Date.now() + timeoutMs;
    let healthy = false;
    while (Date.now() < deadline && child.exitCode === null && !childError) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { redirect: "error", signal: AbortSignal.timeout(500) });
        const body = await response.text();
        if (response.status !== 200 || body.length > 1024 || !isDeepStrictEqual(JSON.parse(body), { ok: true, scope: "zaruku" })) {
          throw new Error("invalid health");
        }
        healthy = true;
        break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    if (!healthy) throw new Error("boot health contract failed");
  } catch { throw new Error("Zaruku standalone boot/health check failed"); }
  finally {
    if (child) {
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 1000);
      await closed;
      clearTimeout(force);
    }
  }
  const after = assertRuntimeArtifact(root, scope, trustedManifestPath);
  if (loadTrustedManifest(root, trustedManifestPath).manifestDigest !== authorityDigest) throw new Error("trusted authority changed during boot");
  if (!isDeepStrictEqual([...before].map(([name, file]) => [name, file.digest]), [...after].map(([name, file]) => [name, file.digest]))) {
    throw new Error("artifact changed during boot/health check");
  }
}

export function stampRuntimeArtifact(artifactRoot, scope, sourceSha, trustedManifestPath) {
  if (scope !== "zaruku") throw new Error(`unsupported runtime scope ${scope}`);
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) throw new Error("source SHA must be exactly 40 lowercase hex characters");
  const root = path.resolve(artifactRoot);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("artifact root must be a real directory");
  const trusted = loadTrustedManifest(root, trustedManifestPath);
  if (trusted.sourceSha !== sourceSha || trusted.scope !== scope) throw new Error("trusted release authority mismatch");
  // Node has no portable openat/renameat API. The trusted local-build helper
  // pins directory descriptors on macOS/Linux; deployed read/boot policy is JS-only.
  try {
    execFileSync("python3", ["-I", "-B", path.join(REPOSITORY_ROOT, "scripts/stamp-runtime-artifact.py"), root, sourceSha],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 30000 });
  } catch { throw new Error("Unsafe runtime stamping input or destination (Python 3 required)"); }
}

function usage() {
  return "usage: runtime-artifact-policy.mjs [--prepare|--stamp|--boot] zaruku <artifact-root> --trusted-manifest <external-path>";
}

async function main() {
  const args = process.argv.slice(2);
  const manifestIndex = args.indexOf("--trusted-manifest");
  const trustedManifestPath = manifestIndex >= 0 ? args[manifestIndex + 1] : undefined;
  if (!trustedManifestPath || manifestIndex !== args.length - 2) throw new Error(usage());
  args.splice(manifestIndex, 2);
  const prepare = args[0] === "--prepare";
  const stamp = args[0] === "--stamp";
  const boot = args[0] === "--boot";
  const positional = prepare || stamp || boot ? args.slice(1) : args;
  if (positional.length !== 2) throw new Error(usage());
  const [scope, artifactRoot] = positional;
  if (prepare || stamp) {
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (prepare) createTrustedRuntimeManifest(artifactRoot, scope, sourceSha, trustedManifestPath);
    else {
      stampRuntimeArtifact(artifactRoot, scope, sourceSha, trustedManifestPath);
      assertRuntimeArtifact(artifactRoot, scope, trustedManifestPath);
    }
  } else if (boot) {
    await verifyRuntimeArtifactBoot(artifactRoot, scope, { trustedManifestPath });
    console.log("Zaruku standalone loopback boot/health passed");
  } else {
    assertRuntimeArtifact(artifactRoot, scope, trustedManifestPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
