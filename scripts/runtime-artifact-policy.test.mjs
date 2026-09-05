import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs, { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertRuntimeArtifact,
  inspectRuntimeArtifact,
  stampRuntimeArtifact,
} from "./runtime-artifact-policy.mjs";
import * as runtimePolicy from "./runtime-artifact-policy.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_ROOT = "apps/zaruku/.next-zaruku";
const EXPECTED_ROUTES = {
  "/_global-error/page": "app/_global-error/page.js",
  "/_not-found/page": "app/_not-found/page.js",
  "/api/dashboard/zaruku/excel/route": "app/api/dashboard/zaruku/excel/route.js",
  "/api/dashboard/zaruku/pdf/route": "app/api/dashboard/zaruku/pdf/route.js",
  "/api/dashboard/zaruku/route": "app/api/dashboard/zaruku/route.js",
  "/api/health/route": "app/api/health/route.js",
  "/dashboard/zaruku/page": "app/dashboard/zaruku/page.js",
};
const FIXTURE_CONFIG = { output: "standalone", distDir: ".next-zaruku", assetPrefix: "/_next-zaruku", basePath: "", env: {} };
const FIXTURE_SERVER = `const path = require('path')
const dir = path.join(__dirname)
process.env.NODE_ENV = 'production'
process.chdir(__dirname)
const currentPort = parseInt(process.env.PORT, 10) || 3000
const hostname = process.env.HOSTNAME || '0.0.0.0'
let keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
const nextConfig = ${JSON.stringify({ ...FIXTURE_CONFIG, distDir: "./.next-zaruku" })}
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

function write(root, relativePath, contents = "fixture") {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function createArtifact() {
  const root = mkdtempSync(path.join(tmpdir(), "zaruku-artifact-"));
  write(root, ".release-source-sha", `${SOURCE_SHA}\n`);
  write(root, ".release-runtime-scope", "zaruku\n");
  write(root, ".env", "DB_HOST=127.0.0.1\n");
  write(root, "apps/zaruku/server.js", FIXTURE_SERVER);
  const routes = Object.keys(EXPECTED_ROUTES).map((route) => route.replace(/\/(page|route)$/, ""));
  const authorities = {
    "build-manifest.json": { pages: { "/_app": [] }, rootMainFilesTree: {}, devFiles: [] },
    "server/middleware-manifest.json": { version: 3, middleware: {}, functions: {}, sortedMiddleware: [] },
    "server/pages-manifest.json": { "/404": "pages/404.html", "/500": "pages/500.html" },
    "server/functions-config-manifest.json": { version: 1, functions: {} },
    "server/server-reference-manifest.json": { node: {}, edge: {} },
    "app-path-routes-manifest.json": Object.fromEntries(Object.keys(EXPECTED_ROUTES).map((route, i) => [route, routes[i]])),
    "routes-manifest.json": { version: 3, appType: "app", basePath: "", headers: [], dynamicRoutes: [], dataRoutes: [],
      redirects: [{ source: "/:path+/", destination: "/:path+", internal: true, priority: true, statusCode: 308, regex: "^(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))/$" }],
      rewrites: { beforeFiles: [{ source: "/_next-zaruku/_next/:path+", destination: "/_next/:path+", regex: "^/_next-zaruku/_next(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))(?:/)?$" }], afterFiles: [], fallback: [] },
      staticRoutes: routes.sort().map((page) => ({ page, regex: `^${page.replace(/-/g, "\\-")}(?:/)?$`, routeKeys: {}, namedRegex: `^${page.replace(/-/g, "\\-")}(?:/)?$` })),
    },
    "prerender-manifest.json": { version: 4, routes: Object.fromEntries(["/_global-error", "/_not-found"].map((route) => [route, { srcRoute: route, dataRoute: `${route}.rsc` }])), dynamicRoutes: {}, notFoundRoutes: [] },
    "required-server-files.json": { version: 1, relativeAppDir: "apps/zaruku", config: FIXTURE_CONFIG, files: [".next-zaruku/server/app-paths-manifest.json"] },
  };
  for (const [filename, content] of Object.entries(authorities)) write(root, `${NEXT_ROOT}/${filename}`, JSON.stringify(content));
  write(root, `${NEXT_ROOT}/BUILD_ID`, "fixture-build");
  write(
    root,
    "apps/zaruku/.next-zaruku/server/app-paths-manifest.json",
    `${JSON.stringify(EXPECTED_ROUTES, null, 2)}\n`,
  );
  for (const target of Object.values(EXPECTED_ROUTES)) {
    write(root, `apps/zaruku/.next-zaruku/server/${target}`, "// safe compiled route\n");
  }
  write(
    root,
    "apps/zaruku/.next-zaruku/server/chunks/safe.js",
    "const administration = { privateState: false, sourceApiCalls: 0 };\n",
  );
  return root;
}

function withArtifact(run) {
  const root = createArtifact();
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts the complete Zaruku standalone route set and root runtime .env", () => {
  withArtifact((root) => {
    assert.deepEqual(inspectRuntimeArtifact(root, "zaruku"), []);
    assert.doesNotThrow(() => assertRuntimeArtifact(root, "zaruku"));
  });
});

test("rejects every prohibited cross-domain marker in artifact contents", async (t) => {
  const forbidden = [
    "server/app/dashboard/abbott",
    "server/app/api/dashboard/abbott",
    "abbott-private-store",
    "report_bd_private",
    "ABBOTT_PRIVATE_DB_PASSWORD",
    "server/app/admin",
  ];

  for (const [index, marker] of forbidden.entries()) {
    await t.test(marker, () => {
      withArtifact((root) => {
        write(root, `apps/zaruku/.next-zaruku/server/chunks/forbidden-${index}.js`, marker);
        assert.ok(
          inspectRuntimeArtifact(root, "zaruku").some((violation) => violation.includes(`forbidden-${index}.js`)),
        );
      });
    });
  }
});

test("rejects prohibited route paths even when their files contain no marker", () => {
  withArtifact((root) => {
    write(root, "apps/zaruku/.next-zaruku/server/app/dashboard/abbott/page.js", "export default 1");
    write(root, "apps/zaruku/.next-zaruku/server/app/admin/page.js", "export default 1");
    const violations = inspectRuntimeArtifact(root, "zaruku");
    assert.ok(violations.some((violation) => violation.includes("server/app/dashboard/abbott/page.js")));
    assert.ok(violations.some((violation) => violation.includes("server/app/admin/page.js")));
  });
});

test("rejects unowned bindings, source API clients, and combined middleware", async (t) => {
  for (const [index, marker] of [
    "abbott-bi-loader",
    "advertising-binding-read-model",
    "api-metrika.yandex.net",
    "api.webmaster.yandex.net",
    "googleads.googleapis.com",
    "METRIKA_TOKEN",
    "YANDEX_DIRECT_TOKEN",
  ].entries()) {
    await t.test(marker, () => {
      withArtifact((root) => {
        write(root, `apps/zaruku/.next-zaruku/server/chunks/unowned-${index}.js`, marker);
        assert.ok(
          inspectRuntimeArtifact(root, "zaruku").some((violation) => violation.includes(`unowned-${index}.js`)),
        );
      });
    });
  }

  await t.test("combined middleware", () => {
    withArtifact((root) => {
      write(root, "apps/zaruku/.next-zaruku/server/middleware.js", "export default 1");
      assert.ok(
        inspectRuntimeArtifact(root, "zaruku").some((violation) => violation.includes("server/middleware.js")),
      );
    });
  });
});

test("requires exact release metadata and the Zaruku standalone server", async (t) => {
  for (const relativePath of [".release-source-sha", ".release-runtime-scope", "apps/zaruku/server.js"]) {
    await t.test(`missing ${relativePath}`, () => {
      withArtifact((root) => {
        rmSync(path.join(root, relativePath));
        assert.ok(inspectRuntimeArtifact(root, "zaruku").some((violation) => violation.includes(relativePath)));
      });
    });
  }

  await t.test("invalid SHA and wrong scope", () => {
    withArtifact((root) => {
      write(root, ".release-source-sha", "not-a-git-sha\n");
      write(root, ".release-runtime-scope", "combined\n");
      const violations = inspectRuntimeArtifact(root, "zaruku");
      assert.ok(violations.some((violation) => violation.includes(".release-source-sha")));
      assert.ok(violations.some((violation) => violation.includes(".release-runtime-scope")));
    });
  });
});

test("rejects missing and unexpected application routes", async (t) => {
  await t.test("missing owned route", () => {
    withArtifact((root) => {
      const routes = { ...EXPECTED_ROUTES };
      delete routes["/api/dashboard/zaruku/pdf/route"];
      write(
        root,
        "apps/zaruku/.next-zaruku/server/app-paths-manifest.json",
        `${JSON.stringify(routes)}\n`,
      );
      assert.ok(
        inspectRuntimeArtifact(root, "zaruku").some((violation) =>
          violation.includes("missing route /api/dashboard/zaruku/pdf/route")),
      );
    });
  });

  await t.test("unexpected foreign route", () => {
    withArtifact((root) => {
      write(
        root,
        "apps/zaruku/.next-zaruku/server/app-paths-manifest.json",
        `${JSON.stringify({ ...EXPECTED_ROUTES, "/dashboard/client/page": "app/dashboard/client/page.js" })}\n`,
      );
      assert.ok(
        inspectRuntimeArtifact(root, "zaruku").some((violation) =>
          violation.includes("unexpected route /dashboard/client/page")),
      );
    });
  });

  await t.test("unmanifested foreign route file", () => {
    withArtifact((root) => {
      write(root, "apps/zaruku/.next-zaruku/server/app/dashboard/client/page.js", "export default 1");
      assert.ok(
        inspectRuntimeArtifact(root, "zaruku").some((violation) =>
          violation.includes("unexpected compiled route app/dashboard/client/page.js")),
      );
    });
  });
});

test("rejects source workbooks and unapproved .env variants", () => {
  withArtifact((root) => {
    write(root, "uploads/source.xlsx", "not followed or parsed");
    write(root, ".env.production", "ABBOTT_SECRET=hidden\n");
    write(root, "apps/zaruku/.env", "NESTED_SECRET=hidden\n");
    const violations = inspectRuntimeArtifact(root, "zaruku");
    assert.ok(violations.some((violation) => violation.includes("uploads/source.xlsx")));
    assert.ok(violations.some((violation) => violation.includes(".env.production")));
    assert.ok(violations.some((violation) => violation.includes("apps/zaruku/.env")));
  });
});

test("rejects private JSON and delimited source exports structurally", () => {
  withArtifact((root) => {
    write(root, "exports/users.json", `${JSON.stringify([{ visit_id: "v1", user_id: "u1" }])}\n`);
    write(root, "exports/visits.csv", "client_id,visit_id,start_url,end_url\n1,2,/a,/b\n");
    write(root, "exports/events.tsv", "protected_visit_id\tevent_sequence\tnormalized_path\n1\t2\t/a\n");
    const violations = inspectRuntimeArtifact(root, "zaruku");
    assert.ok(violations.some((violation) => violation.includes("exports/users.json")));
    assert.ok(violations.some((violation) => violation.includes("exports/visits.csv")));
    assert.ok(violations.some((violation) => violation.includes("exports/events.tsv")));
  });
});

test("rejects escaping symlinks without scanning their targets", () => {
  withArtifact((root) => {
    const outside = mkdtempSync(path.join(tmpdir(), "zaruku-outside-"));
    try {
      write(outside, "secret.txt", "ABBOTT_PRIVATE_DB_PASSWORD");
      symlinkSync(path.join(outside, "secret.txt"), path.join(root, "outside-secret"));
      const violations = inspectRuntimeArtifact(root, "zaruku");
      assert.ok(violations.some((violation) => violation.includes("outside-secret")));
      assert.ok(violations.some((violation) => violation.includes("symlink forbidden")));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("rejects unnecessary contained symlinks", () => {
  withArtifact((root) => {
    write(root, "node_modules/example/index.js", "export default 1");
    symlinkSync("example", path.join(root, "node_modules/example-link"));
    assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes("example-link")));
  });
});

test("review: root environment is strict UTF-8 rendered Zaruku configuration", async (t) => {
  const cases = {
    ABBOTT_PRIVATE_DB_HOST: "ABBOTT_PRIVATE_DB_HOST=sensitive\n",
    ABBOTT_PRIVATE_DB_USER: "ABBOTT_PRIVATE_DB_USER=sensitive\n",
    ABBOTT_PRIVATE_DB_PASSWORD: "ABBOTT_PRIVATE_DB_PASSWORD=sensitive\n",
    collector: "COLLECTOR_TOKEN=sensitive\n",
    webmaster: "YANDEX_WEBMASTER_OAUTH_TOKEN=sensitive\n",
    google: "GOOGLE_ADS_REFRESH_TOKEN=sensitive\n",
    advertising: "ADVERTISING_DB_PASSWORD=sensitive\n",
    admin: "DASHBOARD_ADMIN_PASSWORD=sensitive\n",
    ai: "AI_SUMMARY_API_KEY=sensitive\n",
    database_alias: "MYSQL_DB_STAT=sensitive\n",
    malformed: "DB_HOST localhost\n",
    duplicate: "DB_HOST=one\nDB_HOST=two\n",
    bom: Buffer.from("\ufeffDB_HOST=localhost\n"),
    utf16: Buffer.from("ABBOTT_PRIVATE_DB_HOST=sensitive\n", "utf16le"),
    invalid_utf8: Buffer.from([0x44, 0x42, 0x5f, 0x48, 0x4f, 0x53, 0x54, 0x3d, 0xff, 0x0a]),
    unterminated_quote: 'DB_PASSWORD="sensitive\n',
    oversized: `DB_PASSWORD=${"x".repeat(65536)}\n`,
  };
  for (const [name, contents] of Object.entries(cases)) await t.test(name, () => {
    withArtifact((root) => {
      write(root, ".env", contents);
      const violations = inspectRuntimeArtifact(root, "zaruku");
      assert.ok(violations.some((item) => item.includes(".env")), name);
      assert.ok(violations.every((item) => !item.includes("sensitive")));
    });
  });
});

test("review: rejects alternate app roots and foreign executable trees", async (t) => {
  for (const filename of ["apps/advertising/server.js", "apps/advertising/.next/server/app/secret/route.js",
    "server.js", "other/.next/server/app/secret/route.js", `${NEXT_ROOT}/server/edge-chunks/secret.js`,
    `${NEXT_ROOT}/server/pages/secret.js`]) await t.test(filename, () => withArtifact((root) => {
    write(root, filename, "module.exports = {};\n");
    assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes(filename)));
  }));
});

test("review: rejects unowned Next route authority", async (t) => {
  const fixtures = {
    "server/middleware-manifest.json": { version: 3, middleware: { "/secret": { files: ["edge.js"] } }, functions: {}, sortedMiddleware: ["/secret"] },
    "server/functions-config-manifest.json": { version: 1, functions: { "/secret": {} } },
    "server/pages-manifest.json": { "/404": "pages/404.html", "/500": "pages/500.html", "/secret": "pages/secret.js" },
    "app-path-routes-manifest.json": { ...Object.fromEntries(Object.keys(EXPECTED_ROUTES).map((route) => [route, route.replace(/\/(page|route)$/, "")])), "/secret/route": "/secret" },
    "routes-manifest.json": { version: 3, redirects: [{ source: "/secret", destination: "/admin", statusCode: 307 }], rewrites: { beforeFiles: [], afterFiles: [], fallback: [] } },
  };
  for (const [filename, contents] of Object.entries(fixtures)) await t.test(filename, () => withArtifact((root) => {
    write(root, `${NEXT_ROOT}/${filename}`, JSON.stringify(contents));
    assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes(filename)));
  }));
  await t.test("unexpected rewrite", () => withArtifact((root) => {
    write(root, `${NEXT_ROOT}/routes-manifest.json`, JSON.stringify({ version: 3, redirects: [], rewrites: [{ source: "/secret", destination: "https://example.invalid" }] }));
    assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes("routes-manifest.json")));
  }));
});

test("review: rejects opaque archives, workbook families and encoded exports", async (t) => {
  for (const suffix of ["zip", "tar", "tar.gz", "tgz", "gz", "tar.bz2", "tar.xz", "7z", "rar", "xlsm", "xlsb", "ods"]) {
    await t.test(suffix, () => withArtifact((root) => {
      write(root, `payload.${suffix}`, "opaque payload");
      assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes(`payload.${suffix}`)));
    }));
  }
  for (const suffix of ["csv", "tsv"]) await t.test(`utf16 ${suffix}`, () => withArtifact((root) => {
    write(root, `payload.${suffix}`, Buffer.from("visit_id,client_id,start_url,end_url\n1,2,/a,/b\n", "utf16le"));
    assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes(`payload.${suffix}`)));
  }));
  await t.test("renamed ZIP magic", () => withArtifact((root) => {
    write(root, "payload.data", Buffer.from([0x50, 0x4b, 3, 4, 0, 0]));
    assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes("payload.data")));
  }));
});

test("review: rejects comment-only and fake standalone servers", async (t) => {
  for (const content of ["// isolated standalone\n", "require('next'); console.log('ready');\n"]) {
    await t.test(content.split(";")[0], () => withArtifact((root) => {
      write(root, "apps/zaruku/server.js", content);
      assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes("server.js")));
    }));
  }
});

test("review: path policy applies to contained symlinks", async (t) => {
  for (const filename of [".env.production", "apps/advertising/server.js", `${NEXT_ROOT}/server/app/secret/route.js`]) {
    await t.test(filename, () => withArtifact((root) => {
      const link = path.join(root, filename);
      mkdirSync(path.dirname(link), { recursive: true });
      symlinkSync(path.join(root, ".release-source-sha"), link);
      assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes(filename)));
    }));
  }
});

test("review: replacing a checked file with a symlink before open fails closed", () => {
  withArtifact((root) => {
    const filename = path.join(root, `${NEXT_ROOT}/server/chunks/swap.js`);
    write(root, `${NEXT_ROOT}/server/chunks/swap.js`, "safe\n");
    const originalOpen = fs.openSync;
    const replacement = mock.method(fs, "openSync", (target, ...args) => {
      if (target === filename) {
        rmSync(filename);
        symlinkSync(path.join(root, ".release-source-sha"), filename);
      }
      return originalOpen(target, ...args);
    });
    try {
      assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes("swap.js")));
    } finally { replacement.mock.restore(); }
  });
});

test("review: accepts the complete rendered environment contract without exposing values", () => withArtifact((root) => {
  const values = {
    DB_HOST: "127.0.0.1", DB_PORT: "3306", DB_USER: "zaruku_reader", DB_PASSWORD: '"test # value"', DB_NAME: "report_bd",
    MYSQL_HOST: "127.0.0.1", MYSQL_PORT: "3306", MYSQL_USER: "zaruku_reader", MYSQL_PASSWORD: "'test value'", MYSQL_DB: "report_bd",
    NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: "3002", NEXT_PUBLIC_BASE_URL: "https://dashboards.test",
    DASHBOARD_AUTH_SECRET: "test-secret", INTERNAL_BASE_URL: "http://127.0.0.1:3002", PUPPETEER_EXECUTABLE_PATH: "/usr/bin/chromium",
  };
  write(root, ".env", `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
  assert.deepEqual(inspectRuntimeArtifact(root, "zaruku"), []);
}));

test("review: limits and encoding checks apply inside allowed directories", async (t) => {
  for (const [filename, content] of [
    ["archive.zip", "ordinary bytes"], ["workbook.xlsm", "ordinary bytes"],
    ["export.csv", Buffer.from("visit_id,user_id\n1,2\n", "utf16le")],
    ["oversized.js", "a".repeat(32 * 1024 * 1024 + 1)],
    ["renamed.js", Buffer.from([0x50, 0x4b, 3, 4])],
  ]) await t.test(filename, () => withArtifact((root) => {
    const relative = `${NEXT_ROOT}/server/chunks/${filename}`;
    write(root, relative, content);
    assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes(relative)));
  }));
});

test("review: denies arbitrary app executables and instrumentation", async (t) => {
  for (const filename of ["apps/zaruku/secret-server.js", `${NEXT_ROOT}/server/instrumentation.js`, `${NEXT_ROOT}/server/secret-server.js`]) {
    await t.test(filename, () => withArtifact((root) => {
      write(root, filename, "module.exports = {};\n");
      assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes(filename)));
    }));
  }
});

test("review: bootstrap metadata must match the executable config", () => withArtifact((root) => {
  const name = `${NEXT_ROOT}/required-server-files.json`;
  const required = JSON.parse(readFileSync(path.join(root, name), "utf8"));
  required.config.assetPrefix = "/foreign";
  write(root, name, JSON.stringify(required));
  assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes("server.js")));
}));

test("review: server validation preserves whitespace inside executable string literals", () => withArtifact((root) => {
  write(root, "apps/zaruku/server.js", FIXTURE_SERVER.replace("require('next')", "require('n e x t')"));
  assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes("server.js")));
}));

test("review: build manifest cannot declare an extra page", () => withArtifact((root) => {
  write(root, `${NEXT_ROOT}/build-manifest.json`, JSON.stringify({ pages: { "/_app": [], "/secret": [] }, rootMainFilesTree: {}, devFiles: [] }));
  assert.ok(inspectRuntimeArtifact(root, "zaruku").some((item) => item.includes("build-manifest.json")));
}));

test("review: boot checker validates health and cannot accept a non-server fixture", async () => {
  assert.equal(typeof runtimePolicy.verifyRuntimeArtifactBoot, "function");
  const root = createArtifact();
  try { await assert.rejects(runtimePolicy.verifyRuntimeArtifactBoot(root, "zaruku", { timeoutMs: 1000 }), /boot|health/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});

test("review: workspace provides an explicit post-seal loopback boot gate", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "apps/zaruku/package.json")));
  assert.equal(pkg.scripts["verify:boot"], "node ../../scripts/runtime-artifact-policy.mjs --boot zaruku .next-zaruku/standalone");
});

test("stamps immutable scope and source metadata for a fresh build", () => {
  const root = mkdtempSync(path.join(tmpdir(), "zaruku-stamp-"));
  try {
    write(root, "apps/zaruku/server.js", "// standalone\n");
    stampRuntimeArtifact(root, "zaruku", SOURCE_SHA);
    assert.equal(readFileSync(path.join(root, ".release-source-sha"), "utf8"), `${SOURCE_SHA}\n`);
    assert.equal(readFileSync(path.join(root, ".release-runtime-scope"), "utf8"), "zaruku\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stamping removes monorepo-only package metadata from the standalone root", () => {
  const root = mkdtempSync(path.join(tmpdir(), "zaruku-stamp-package-"));
  try {
    write(root, "apps/zaruku/server.js", "// standalone\n");
    write(
      root,
      "package.json",
      `${JSON.stringify({
        name: "dashboard-next",
        version: "0.1.0",
        private: true,
        workspaces: ["apps/*"],
        scripts: { "test:abbott": "node abbott-private-store.test.ts" },
        dependencies: { next: "16.1.6" },
        devDependencies: { typescript: "^5" },
      })}\n`,
    );
    stampRuntimeArtifact(root, "zaruku", SOURCE_SHA);
    assert.deepEqual(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")), {
      name: "dashboard-next",
      version: "0.1.0",
      private: true,
      dependencies: { next: "16.1.6" },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the existing release asset entry point enforces the scoped runtime policy", () => {
  withArtifact((root) => {
    write(root, "apps/zaruku/.next-zaruku/server/app/admin/page.js", "export default 1");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/assert-no-private-public-assets.ts",
        "--release",
        "--scope",
        "zaruku",
        root,
      ],
      { cwd: REPOSITORY_ROOT, encoding: "utf8" },
    );
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /server\/app\/admin\/page\.js/);
  });
});

test("the Zaruku workspace stamps then verifies its standalone artifact", () => {
  const packageJson = JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "apps/zaruku/package.json"), "utf8"));
  assert.equal(
    packageJson.scripts.build,
    "next build --webpack && node ../../scripts/runtime-artifact-policy.mjs --stamp zaruku .next-zaruku/standalone",
  );
  assert.equal(
    packageJson.scripts["verify:artifact"],
    "node --import tsx ../../scripts/assert-no-private-public-assets.ts --release --scope zaruku .next-zaruku/standalone",
  );
});
