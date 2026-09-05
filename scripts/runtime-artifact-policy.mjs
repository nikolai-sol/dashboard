import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createServer } from "node:net";
import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
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

function inspectFileClosure(files, violations) {
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
  for (const name of files.keys()) if (!allowed.has(name)) violations.push(`untraced artifact file ${name}`);
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
function inspectTree(root, violations) {
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
      if (archiveMagic(buffer)) throw new Error("opaque container");
      // Native runtime dependencies are the sole binary exception in current tracing.
      const binary = relativePath.startsWith("node_modules/") && /\.(?:node|dylib|so(?:\.\d+)*)$/.test(relativePath);
      const text = binary ? buffer.toString("latin1") : decodeUtf8(buffer);
      const contentMarker = FORBIDDEN_CONTENT_MARKERS.find((marker) => text.toLowerCase().includes(marker));
      if (contentMarker) violations.push(`forbidden content marker ${contentMarker}: ${relativePath}`);
      if (relativePath === ".env") inspectEnvironment(text);
      if (!binary && hasPrivateSourceExport(text, relativePath)) violations.push(`private source export ${relativePath}`);
      files.set(relativePath, { text, digest: createHash("sha256").update(buffer).digest("hex") });
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

function inspectRuntimeArtifactState(artifactRoot, scope) {
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

  const files = inspectTree(root, violations);
  inspectMetadata(files, scope, violations);
  inspectZarukuRoutes(files, violations);
  inspectFileClosure(files, violations);
  return { files, violations: [...new Set(violations)].sort((left, right) => left.localeCompare(right, "en")) };
}

export function inspectRuntimeArtifact(artifactRoot, scope) {
  return inspectRuntimeArtifactState(artifactRoot, scope).violations;
}

export function assertRuntimeArtifact(artifactRoot, scope) {
  const { files, violations } = inspectRuntimeArtifactState(artifactRoot, scope);
  if (violations.length > 0) {
    throw new Error(`Rejected ${scope} runtime artifact:\n${violations.map((item) => `- ${item}`).join("\n")}`);
  }
  return files;
}

export async function verifyRuntimeArtifactBoot(artifactRoot, scope, { timeoutMs = 15000 } = {}) {
  const root = path.resolve(artifactRoot);
  const before = assertRuntimeArtifact(root, scope);
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
  const after = assertRuntimeArtifact(root, scope);
  if (!isDeepStrictEqual([...before].map(([name, file]) => [name, file.digest]), [...after].map(([name, file]) => [name, file.digest]))) {
    throw new Error("artifact changed during boot/health check");
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
  const sourceTrace = path.join(path.dirname(root), "next-server.js.nft.json");
  const sourceStat = lstatSync(sourceTrace);
  if (!sourceStat.isFile() || sourceStat.nlink !== 1 || sourceStat.size > MAX_FILE_BYTES) throw new Error("invalid standalone server trace");
  const fd = fs.openSync(sourceTrace, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { writeFileSync(path.join(root, ZARUKU_NEXT, "next-server.js.nft.json"), readFileSync(fd), { flag: "wx" }); }
  finally { fs.closeSync(fd); }
  removeMonorepoPackageMetadata(root);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, ".release-source-sha"), `${sourceSha}\n`, { flag: "wx" });
  writeFileSync(path.join(root, ".release-runtime-scope"), `${scope}\n`, { flag: "wx" });
}

function usage() {
  return "usage: runtime-artifact-policy.mjs [--stamp|--boot] zaruku <artifact-root>";
}

async function main() {
  const args = process.argv.slice(2);
  const stamp = args[0] === "--stamp";
  const boot = args[0] === "--boot";
  const positional = stamp || boot ? args.slice(1) : args;
  if (positional.length !== 2) throw new Error(usage());
  const [scope, artifactRoot] = positional;
  if (stamp) {
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    stampRuntimeArtifact(artifactRoot, scope, sourceSha);
  } else if (boot) {
    await verifyRuntimeArtifactBoot(artifactRoot, scope);
    console.log("Zaruku standalone loopback boot/health passed");
  } else {
    assertRuntimeArtifact(artifactRoot, scope);
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
