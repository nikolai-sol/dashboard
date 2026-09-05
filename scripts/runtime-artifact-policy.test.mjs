import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertRuntimeArtifact,
  inspectRuntimeArtifact,
  stampRuntimeArtifact,
} from "./runtime-artifact-policy.mjs";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXPECTED_ROUTES = {
  "/_global-error/page": "app/_global-error/page.js",
  "/_not-found/page": "app/_not-found/page.js",
  "/api/dashboard/zaruku/excel/route": "app/api/dashboard/zaruku/excel/route.js",
  "/api/dashboard/zaruku/pdf/route": "app/api/dashboard/zaruku/pdf/route.js",
  "/api/dashboard/zaruku/route": "app/api/dashboard/zaruku/route.js",
  "/api/health/route": "app/api/health/route.js",
  "/dashboard/zaruku/page": "app/dashboard/zaruku/page.js",
};

function write(root, relativePath, contents = "fixture") {
  const absolutePath = path.join(root, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents);
}

function createArtifact() {
  const root = mkdtempSync(path.join(tmpdir(), "zaruku-artifact-"));
  write(root, ".release-source-sha", `${SOURCE_SHA}\n`);
  write(root, ".release-runtime-scope", "zaruku\n");
  write(root, ".env", "DATABASE_HOST=127.0.0.1\n");
  write(root, "apps/zaruku/server.js", "// isolated Zaruku standalone server\n");
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
      assert.ok(violations.some((violation) => violation.includes("escapes artifact root")));
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

test("allows contained symlinks and does not recursively follow them", () => {
  withArtifact((root) => {
    write(root, "node_modules/example/index.js", "export default 1");
    symlinkSync("example", path.join(root, "node_modules/example-link"));
    assert.deepEqual(inspectRuntimeArtifact(root, "zaruku"), []);
  });
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
