# Task 1 Report: Runtime Ownership Contract

## Implementation

Implemented the pure runtime ownership contract for the isolated dashboard runtimes:

- Added `DashboardRuntimeScope`, `DashboardFamily`, and `DashboardIdentity` types.
- Added the immutable Zaruku production `RUNTIME_MANIFESTS` entry with the required release branch, app, port, directories, lock path, and asset prefix.
- Added canonical dashboard-family resolution, including Zaruku and Abbott special-dashboard precedence over generic advertising.
- Added fail-closed dashboard ownership checks for isolated scopes and preserved combined-runtime ownership.
- Added route ownership checks for current Zaruku and Abbott dashboard/API paths, with other paths remaining advertising-owned.
- Added the `@reportingdash/runtime-contract` workspace package.
- Added root `apps/*` and `packages/*` workspaces while preserving every existing package script and dependency.
- Added the `@reportingdash/runtime-contract` TypeScript path alias while preserving `@/*`.

## RED

Command:

```text
node --import tsx --test packages/runtime-contract/src/index.test.ts
```

Output (exit 1):

```text
node:internal/modules/cjs/loader:1455
  const err = new Error(message);
              ^

Error: Cannot find module './index'
Require stack:
- /Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation/packages/runtime-contract/src/index.test.ts
    at Module._resolveFilename (node:internal/modules/cjs/loader:1455:15)
    at m._resolveFilename (file:///Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-B7jrtLTO.mjs:1:789)
    at nextResolveSimple (/Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-D46fvsV_.cjs:4:1004)
    at /Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-D46fvsV_.cjs:3:2630
    at /Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-D46fvsV_.cjs:3:1542
    at resolveTsPaths (/Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-D46fvsV_.cjs:4:760)
    at Module._resolveFilename (file:///Users/nafanya/ReportingDash/dashboard-next/node_modules/tsx/dist/register-D46fvsV_.cjs:4:1102)
    at defaultResolveImpl (node:internal/modules/cjs/loader:1065:19)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1070:15)
    at Module._load (node:internal/modules/cjs/loader:1241:12) {
  code: 'MODULE_NOT_FOUND',
  requireStack: [
    '/Users/nafanya/ReportingDash/dashboard-next/.worktrees/three-dashboard-runtime-isolation/packages/runtime-contract/src/index.test.ts'
  ]
}

Node.js v25.6.1
✖ packages/runtime-contract/src/index.test.ts (202.423833ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 206.882334

✖ failing tests:

test at packages/runtime-contract/src/index.test.ts:1:1
✖ packages/runtime-contract/src/index.test.ts (202.423833ms)
  'test failed'
```

The failure was expected: the test imported the not-yet-created `./index` module.

## GREEN

Command:

```text
node --import tsx --test packages/runtime-contract/src/index.test.ts && npm run typecheck && git diff --check
```

Output (exit 0):

```text
✔ canonical special dashboards resolve before generic advertising (0.407125ms)
✔ isolated runtimes fail closed for another dashboard family (0.058791ms)
✔ public route ownership preserves current paths (0.045125ms)
✔ Zaruku production authority is immutable (0.506709ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 145.171542

> dashboard-next@0.1.0 typecheck
> tsc --noEmit

```

`git diff --check` produced no output and exited 0.

## Files Changed

- `packages/runtime-contract/package.json`
- `packages/runtime-contract/src/index.ts`
- `packages/runtime-contract/src/index.test.ts`
- `package.json`
- `tsconfig.json`
- `.superpowers/sdd/runtime-isolation-task-1-report.md`

## Commit

`feat: define dashboard runtime ownership` (the task commit; its final hash is reported with delivery).

## Self-Review

- The contract is pure and has no source API, OAuth, database, deployment, cron, secret, or production-runtime side effects.
- The combined scope continues to own every dashboard and route, preserving current production behavior.
- Zaruku and Abbott special identities are checked before the advertising fallback; client IDs are trimmed and lowercased.
- Special dashboard and API route prefixes are matched only at their exact route roots or slash-delimited descendants, avoiding accidental partial matches.
- The manifest is `as const`, preserving immutable literal values and the exact requested Zaruku production authority.
- Existing scripts and dependencies were left unchanged.
- Focused tests, typecheck, and whitespace validation all pass.

## Concerns

No active concerns or blockers. The manifest intentionally contains only the requested Zaruku production authority; future runtime manifests should be added explicitly in a successor task.

## Review Fix

### RED evidence

Command:

```text
npm ci --dry-run --ignore-scripts --offline
```

Output (exit 1):

```text
npm error code EUSAGE
npm error
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error
npm error Missing: @reportingdash/runtime-contract@0.1.0 from lock file
npm error Missing: @reportingdash/runtime-contract@0.1.0 from lock file
npm error
npm error Clean install a project
npm error
npm error Usage:
npm error npm ci
npm error
npm error Options:
npm error [--install-strategy <hoisted|nested|shallow|linked>] [--legacy-bundling]
npm error [--global-style] [--omit <dev|optional|peer> [--omit <dev|optional|peer> ...]]
npm error [--strict-peer-deps] [--foreground-scripts] [--ignore-scripts]
npm error [--allow-git <all|none|root>] [--no-audit] [--no-bin-links]
npm error [--include <prod|dev|optional|peer> [--include <prod|dev|optional|peer> ...]]
npm error [--dry-run]
npm error [-w|--workspace <workspace-name> [-w|--workspace <workspace-name> ...]]
npm error [--workspaces] [--include-workspace-root] [--install-links]
npm error
npm error aliases: clean-install, ic, install-clean, isntall-clean
npm error
npm error Run npm help ci for more info
npm error A complete log of this run can be found in: /Users/nafanya/.npm/_logs/2026-09-04T22_14_31_033Z-debug-0.log
```

### GREEN evidence

Command:

```text
npm ci --dry-run --ignore-scripts --offline
```

Output (exit 0; npm also listed the 931 packages in the dry-run):

```text
add @reportingdash/runtime-contract 0.1.0
add zod-validation-error 4.0.2
add zod-to-json-schema 3.25.1
add zod 4.3.6
add zip-stream 4.1.1
add archiver-utils 3.0.4
add yoctocolors-cjs 2.1.3
add yoctocolors 2.1.2
add yocto-queue 0.1.0
add yauzl 2.10.0
add yargs-parser 21.1.1
add yargs 17.7.2
add strip-ansi 6.0.1
add string-width 4.2.3
add emoji-regex 8.0.0
add ansi-regex 5.0.1
add yaml 2.8.2
add yallist 3.1.1
add y18n 5.0.8
add xmlchars 2.2.0
add xlsx 0.18.5
add wsl-utils 0.3.1
add ws 8.19.0
add wrappy 1.0.2
add wrap-ansi 6.2.0
add strip-ansi 6.0.1
add string-width 4.2.3
add emoji-regex 8.0.0
add ansi-regex 5.0.1
add world-atlas 2.0.2
add word-wrap 1.2.5
add word 0.3.0
add wmf 1.0.2
add which-typed-array 1.1.20
add which-collection 1.0.2
add which-builtin-type 1.2.1
add which-boxed-primitive 1.1.1
add which 2.0.2
add webdriver-bidi-protocol 0.4.1
add web-streams-polyfill 3.3.3
add victory-vendor 37.3.6
add d3-time 3.1.0
add @types/d3-time 3.0.4
add vary 1.1.2
add validate-npm-package-name 7.0.2
add uuid 8.3.2
add util-deprecate 1.0.2
add use-sync-external-store 1.6.0
add use-sidecar 1.1.3
add use-debounce 10.1.0
add use-callback-ref 1.3.3
add uri-js 4.4.1
add update-browserslist-db 1.2.3
add unzipper 0.10.14
add string_decoder 1.1.1
add safe-buffer 5.1.2
add readable-stream 2.3.8
add isarray 1.0.0
add until-async 3.0.2
add unrs-resolver 1.11.1
add unpipe 1.0.0
add universalify 2.0.1
add unicorn-magic 0.3.0
add undici-types 6.21.0
add unbox-primitive 1.1.0
add typescript-eslint 8.57.0
add typescript 5.9.3
add typed-query-selector 2.12.1
add typed-array-length 1.0.7
add typed-array-byte-offset 1.0.4
add typed-array-byte-length 1.0.3
add typed-array-buffer 1.0.3
add type-is 2.0.1
add type-fest 5.4.4
add type-check 0.4.0
add tw-animate-css 1.4.0
add tsx 4.21.0
add tslib 2.8.1
add tsconfig-paths 3.15.0
add json5 1.0.2
add ts-morph 26.0.0
add ts-api-utils 2.4.0
add traverse 0.3.9
add tough-cookie 6.0.0
add topojson-client 3.1.0
add commander 2.20.3
add toidentifier 1.0.1
add to-regex-range 5.0.1
add tmp 0.2.5
add tldts-core 7.0.25
add tldts 7.0.25
add tinyglobby 0.2.15
add picomatch 4.0.3
add fdir 6.5.0
add tinyexec 1.0.2
add tiny-invariant 1.3.3
add text-decoder 1.2.7
add teex 1.0.1
add tar-stream 3.1.8
add tar-fs 3.1.2
add tapable 2.3.0
add tailwindcss 4.2.1
add tailwind-merge 3.5.0
add tagged-tag 1.0.0
add tabbable 6.4.0
add supports-preserve-symlinks-flag 1.0.0
add supports-color 7.2.0
add styled-jsx 5.1.6
add strip-json-comments 3.1.1
add strip-final-newline 4.0.0
add strip-bom 3.0.0
add strip-ansi 7.2.0
add stringify-object 5.0.0
add string.prototype.trimstart 1.0.8
add string.prototype.trimend 1.0.9
add string.prototype.trim 1.2.10
add string.prototype.repeat 1.0.0
add string.prototype.matchall 4.0.12
add string.prototype.includes 2.0.1
add string-width 7.2.0
add emoji-regex 10.6.0
add string_decoder 1.3.0
add strict-event-emitter 0.5.1
add streamx 2.23.0
add stop-iteration-iterator 1.1.0
add stdin-discarder 0.2.2
add statuses 2.0.2
add stable-hash 0.0.5
add ssf 0.11.2
add sql-escaper 1.3.3
add source-map-js 1.2.1
add source-map 0.6.1
add socks-proxy-agent 8.0.5
add socks 2.8.7
add smart-buffer 4.2.0
add sisteransi 1.0.5
add signal-exit 4.1.0
add side-channel-weakmap 1.0.2
add side-channel-map 1.0.1
add side-channel-list 1.0.0
add side-channel 1.1.0
add shebang-regex 3.0.0
add shebang-command 2.0.0
add sharp 0.34.5
add semver 7.7.4
add shadcn 4.0.3
add zod 3.25.76
add tsconfig-paths 4.2.0
add glob-parent 5.1.2
add fast-glob 3.3.3
add setprototypeof 1.2.0
add setimmediate 1.0.5
add set-proto 1.0.0
add set-function-name 2.0.2
add set-function-length 1.2.2
add serve-static 2.2.1
add send 1.2.1
add semver 6.3.1
add scheduler 0.27.0
add saxes 5.0.1
add safer-buffer 2.1.2
add safe-regex-test 1.1.0
add safe-push-apply 1.0.0
add safe-buffer 5.2.1
add safe-array-concat 1.1.3
add run-parallel 1.2.0
add run-applescript 7.1.0
add router 2.2.0
add path-to-regexp 8.3.0
add robust-predicates 3.0.2
add rimraf 2.7.1
add reusify 1.1.0
add rettime 0.10.1
add restore-cursor 5.1.0
add resolve-pkg-maps 1.0.0
add resolve-from 4.0.0
add resolve 1.22.11
add reselect 5.1.1
add require-from-string 2.0.2
add require-directory 2.1.1
add regexp.prototype.flags 1.5.4
add reflect.getprototypeof 1.0.10
add redux-thunk 3.1.0
add redux 5.0.1
add recharts 3.8.0
add recast 0.23.11
add readdir-glob 1.1.3
add minimatch 5.1.9
add brace-expansion 2.0.2
add readable-stream 3.6.2
add react-style-singleton 2.2.3
add react-remove-scroll-bar 2.3.8
add react-remove-scroll 2.7.2
add react-redux 9.2.0
add react-is 16.13.1
add react-dom 19.2.3
add react 19.2.3
add raw-body 3.0.2
add range-parser 1.2.1
add queue-microtask 1.2.3
add qs 6.15.0
add puppeteer-core 24.39.1
add puppeteer 24.39.1
add punycode 2.3.1
add pump 3.0.4
add proxy-from-env 1.1.0
add proxy-agent 6.5.0
add lru-cache 7.18.3
add proxy-addr 2.0.7
add prop-types 15.8.1
add prompts 2.4.2
add kleur 3.0.3
add progress 2.0.3
add process-nextick-args 2.0.1
add pretty-ms 9.3.0
add prelude-ls 1.2.1
add powershell-utils 0.1.0
add postcss-selector-parser 7.1.1
add postcss 8.5.8
add possible-typed-array-names 1.1.0
add pkce-challenge 5.0.1
add picomatch 2.3.1
add picocolors 1.1.1
add pend 1.2.0
add path-to-regexp 6.3.0
add path-parse 1.0.7
add path-key 3.1.1
add path-is-absolute 1.0.1
add path-exists 4.0.0
add path-browserify 1.0.1
add parseurl 1.3.3
add parse-ms 4.0.0
add parse-json 5.2.0
add parent-module 1.0.1
add papaparse 5.5.3
add pako 1.0.11
add package-manager-detector 1.6.0
add pac-resolver 7.0.1
add pac-proxy-agent 7.2.0
add p-locate 5.0.0
add p-limit 3.1.0
add own-keys 1.0.1
add outvariant 1.4.3
add ora 8.2.0
add chalk 5.6.2
add optionator 0.9.4
add open 11.0.0
add onetime 7.0.0
add once 1.4.0
add on-finished 2.4.1
add object.values 1.2.1
add object.groupby 1.0.3
add object.fromentries 2.0.8
add object.entries 1.1.9
add object.assign 4.1.7
add object-treeify 1.1.33
add object-keys 1.1.1
add object-inspect 1.13.4
add object-assign 4.1.1
add npm-run-path 6.0.0
add path-key 4.0.0
add normalize-path 3.0.0
add node-releases 2.0.36
add node-fetch 3.3.2
add node-exports-info 1.6.0
add node-domexception 1.0.0
add next 16.1.6
add postcss 8.4.31
add netmask 2.0.2
add negotiator 1.0.0
add natural-compare 1.4.0
add napi-postinstall 0.3.4
add nanoid 3.3.11
add named-placeholders 1.1.6
add mysql2 3.19.1
add mute-stream 2.0.0
add msw 2.12.10
add cookie 1.1.1
add ms 2.1.3
add mkdirp 0.5.6
add mitt 3.0.1
add minimist 1.2.8
add minimatch 3.1.5
add mimic-function 5.0.1
add mimic-fn 2.1.0
add mime-types 3.0.2
add mime-db 1.54.0
add micromatch 4.0.8
add merge2 1.4.1
add merge-stream 2.0.0
add merge-descriptors 2.0.0
add media-typer 1.1.0
add math-intrinsics 1.1.0
add magic-string 0.30.21
add lucide-react 0.577.0
add lru.min 1.1.4
add lru-cache 5.1.1
add loose-envify 1.4.0
add long 5.3.2
add log-symbols 6.0.0
add is-unicode-supported 1.3.0
add chalk 5.6.2
add lodash.uniq 4.5.0
add lodash.union 4.6.0
add lodash.merge 4.6.2
add lodash.isundefined 3.0.1
add lodash.isplainobject 4.0.6
add lodash.isnil 4.0.0
add lodash.isfunction 3.0.9
add lodash.isequal 4.5.0
add lodash.isboolean 3.0.3
add lodash.groupby 4.6.0
add lodash.flatten 4.4.0
add lodash.escaperegexp 4.1.2
add lodash.difference 4.5.0
add lodash.defaults 4.2.0
add lodash 4.17.23
add locate-path 6.0.0
add listenercount 1.0.1
add lines-and-columns 1.2.4
add lightningcss-darwin-arm64 1.31.1
add lightningcss 1.31.1
add lie 3.3.0
add levn 0.4.1
add lazystream 1.0.1
add string_decoder 1.1.1
add safe-buffer 5.1.2
add readable-stream 2.3.8
add isarray 1.0.0
add language-tags 1.0.9
add language-subtag-registry 0.3.23
add kleur 4.1.5
add keyv 4.5.4
add jszip 3.10.1
add string_decoder 1.1.1
add safe-buffer 5.1.2
add readable-stream 2.3.8
add isarray 1.0.0
add jsx-ast-utils 3.3.5
add jsonfile 6.2.0
add json5 2.2.3
add json-stable-stringify-without-jsonify 1.0.1
add json-schema-typed 8.0.2
add json-schema-traverse 0.4.1
add json-parse-even-better-errors 2.3.1
add json-buffer 3.0.1
add jsesc 3.1.0
add js-yaml 4.1.1
add js-tokens 4.0.0
add jose 6.2.1
add jiti 2.6.1
add iterator.prototype 1.1.5
add isexe 2.0.0
add isarray 2.0.5
add is-wsl 3.1.1
add is-weakset 2.0.4
add is-weakref 1.1.1
add is-weakmap 2.0.2
add is-unicode-supported 2.1.0
add is-typed-array 1.1.15
add is-symbol 1.1.1
add is-string 1.1.1
add is-stream 4.0.1
add is-shared-array-buffer 1.0.4
add is-set 2.0.3
add is-regexp 3.1.0
add is-regex 1.2.1
add is-property 1.0.2
add is-promise 4.0.0
add is-plain-obj 4.1.0
add is-obj 3.0.0
add is-number-object 1.1.1
add is-number 7.0.0
add is-node-process 1.2.0
add is-negative-zero 2.0.3
add is-map 2.0.3
add is-interactive 2.0.0
add is-inside-container 1.0.0
add is-in-ssh 1.0.0
add is-glob 4.0.3
add is-generator-function 1.1.2
add is-fullwidth-code-point 3.0.0
add is-finalizationregistry 1.1.1
add is-extglob 2.1.1
add is-docker 3.0.0
add is-date-object 1.1.0
add is-data-view 1.0.2
add is-core-module 2.16.1
add is-callable 1.2.7
add is-bun-module 2.0.0
add semver 7.7.4
add is-boolean-object 1.2.2
add is-bigint 1.1.0
add is-async-function 2.1.1
add is-arrayish 0.2.1
add is-array-buffer 3.0.5
add ipaddr.js 1.9.1
add ip-address 10.1.0
add internmap 2.0.3
add internal-slot 1.1.0
add inherits 2.0.4
add inflight 1.0.6
add imurmurhash 0.1.4
add import-fresh 3.3.1
add immer 10.2.0
add immediate 3.0.6
add ignore 5.3.2
add ieee754 1.2.1
add iconv-lite 0.7.2
add human-signals 8.0.1
add https-proxy-agent 7.0.6
add http-proxy-agent 7.0.2
add http-errors 2.0.1
add hono 4.12.7
add hermes-parser 0.25.1
add hermes-estree 0.25.1
add headers-polyfill 4.0.3
add hasown 2.0.2
add has-tostringtag 1.0.2
add has-symbols 1.1.0
add has-proto 1.2.0
add has-property-descriptors 1.0.2
add has-flag 4.0.0
add has-bigints 1.1.0
add graphql 16.13.1
add graceful-fs 4.2.11
add gopd 1.2.0
add globalthis 1.0.4
add globals 14.0.0
add glob-parent 6.0.2
add glob 7.2.3
add get-uri 6.0.5
add data-uri-to-buffer 6.0.2
add get-tsconfig 4.13.6
add get-symbol-description 1.1.0
add get-stream 9.0.1
add get-proto 1.0.1
add get-own-enumerable-keys 1.0.0
add get-nonce 1.0.1
add get-intrinsic 1.3.0
add get-east-asian-width 1.5.0
add get-caller-file 2.0.5
add gensync 1.0.0-beta.2
add generator-function 2.0.1
add generate-function 2.3.1
add fzf 0.5.2
add fuzzysort 3.1.0
add functions-have-names 1.2.3
add function.prototype.name 1.1.8
add function-bind 1.1.2
add fstream 1.0.12
add fsevents 2.3.3
add fs.realpath 1.0.0
add fs-extra 11.3.4
add fs-constants 1.0.0
add fresh 2.0.0
add frac 1.1.2
add forwarded 0.2.0
add formdata-polyfill 4.0.10
add for-each 0.3.5
add flatted 3.4.1
add flat-cache 4.0.1
add find-up 5.0.0
add finalhandler 2.1.1
add fill-range 7.1.1
add file-entry-cache 8.0.0
add figures 6.1.0
add fetch-blob 3.2.0
add fd-slicer 1.1.0
add fastq 1.20.1
add fast-uri 3.1.0
add fast-levenshtein 2.0.6
add fast-json-stable-stringify 2.1.0
add fast-glob 3.3.1
add glob-parent 5.1.2
add fast-fifo 1.3.2
add fast-deep-equal 3.1.3
add fast-csv 4.3.6
add extract-zip 2.0.1
add get-stream 5.2.0
add express-rate-limit 8.3.1
add express 5.2.1
add execa 9.6.1
add exceljs 4.4.0
add eventsource-parser 3.0.6
add eventsource 3.0.7
add events-universal 1.0.1
add eventemitter3 5.0.4
add etag 1.8.1
add esutils 2.0.3
add estraverse 5.3.0
add esrecurse 4.3.0
add esquery 1.7.0
add esprima 4.0.1
add espree 10.4.0
add eslint-visitor-keys 4.2.1
add eslint-scope 8.4.0
add eslint-plugin-react-hooks 7.0.1
add eslint-plugin-react 7.37.5
add resolve 2.0.0-next.6
add eslint-plugin-jsx-a11y 6.10.2
add eslint-plugin-import 2.32.0
add debug 3.2.7
add eslint-module-utils 2.12.1
add debug 3.2.7
add eslint-import-resolver-typescript 3.10.1
add eslint-import-resolver-node 0.3.9
add debug 3.2.7
add eslint-config-next 16.1.6
add globals 16.4.0
add eslint 9.39.4
add escodegen 2.1.0
add escape-string-regexp 4.0.0
add escape-html 1.0.3
add escalade 3.2.0
add esbuild 0.27.3
add es-toolkit 1.45.1
add es-to-primitive 1.3.0
add es-shim-unscopables 1.1.0
add es-set-tostringtag 2.1.0
add es-object-atoms 1.1.1
add es-iterator-helpers 1.2.2
add es-errors 1.3.0
add es-define-property 1.0.1
add es-abstract 1.24.1
add error-ex 1.3.4
add env-paths 2.2.1
add enhanced-resolve 5.20.0
add end-of-stream 1.4.5
add encodeurl 2.0.0
add emoji-regex 9.2.2
add electron-to-chromium 1.5.307
add ee-first 1.1.1
add eciesjs 0.4.18
add duplexer2 0.1.4
add string_decoder 1.1.1
add safe-buffer 5.1.2
add readable-stream 2.3.8
add isarray 1.0.0
add dunder-proto 1.0.1
add dotenv 17.3.1
add doctrine 2.1.0
add diff 8.0.3
add devtools-protocol 0.0.1581282
add detect-node-es 1.1.0
add detect-libc 2.1.2
add depd 2.0.0
add denque 2.1.0
add delaunator 5.0.1
add degenerator 5.0.1
add ast-types 0.13.4
add define-properties 1.2.1
add define-lazy-prop 3.0.0
add define-data-property 1.1.4
add default-browser-id 5.0.1
add default-browser 5.5.0
add deepmerge 4.3.1
add deep-is 0.1.4
add dedent 1.7.2
add decimal.js-light 2.5.1
add debug 4.4.3
add dayjs 1.11.20
add data-view-byte-offset 1.0.1
add data-view-byte-length 1.0.2
add data-view-buffer 1.0.2
add data-uri-to-buffer 4.0.1
add damerau-levenshtein 1.0.8
add d3-timer 3.0.1
add d3-time-format 3.0.0
add d3-time 1.1.0
add d3-shape 3.2.0
add d3-scale-chromatic 3.1.0
add d3-scale 4.0.2
add d3-time 3.1.0
add d3-path 3.1.0
add d3-interpolate 3.0.1
add d3-geo 3.1.0
add d3-format 1.4.5
add d3-ease 3.0.1
add d3-delaunay 6.0.4
add d3-color 3.1.0
add d3-array 3.2.4
add csstype 3.2.3
add cssesc 3.0.0
add cross-spawn 7.0.6
add crc32-stream 4.0.3
add crc-32 1.2.2
add cosmiconfig 9.0.1
add cors 2.8.6
add core-util-is 1.0.3
add cookie-signature 1.2.2
add cookie 0.7.2
add convert-source-map 2.0.0
add content-type 1.0.5
add content-disposition 1.0.1
add concat-map 0.0.1
add compress-commons 4.1.2
add commander 14.0.3
add color-name 1.1.4
add color-convert 2.0.1
add codepage 1.15.0
add code-block-writer 13.0.3
add clsx 2.1.1
add cliui 8.0.1
add wrap-ansi 7.0.0
add strip-ansi 6.0.1
add string-width 4.2.3
add emoji-regex 8.0.0
add ansi-regex 5.0.1
add client-only 0.0.1
add cli-width 4.1.0
add cli-spinners 2.9.2
add cli-cursor 5.0.0
add classnames 2.5.1
add class-variance-authority 0.7.1
add chromium-bidi 14.0.0
add zod 3.25.76
add chalk 4.1.2
add chainsaw 0.1.0
add cfb 1.2.2
add caniuse-lite 1.0.30001777
add callsites 3.1.0
add call-bound 1.0.4
add call-bind-apply-helpers 1.0.2
add call-bind 1.0.8
add bytes 3.1.2
add bundle-name 4.1.0
add buffers 0.1.1
add buffer-indexof-polyfill 1.0.2
add buffer-crc32 0.2.13
add buffer 5.7.1
add browserslist 4.28.1
add braces 3.0.3
add brace-expansion 1.1.12
add body-parser 2.2.2
add bluebird 3.4.7
add bl 4.1.0
add binary 0.3.0
add big-integer 1.6.52
add basic-ftp 5.2.0
add baseline-browser-mapping 2.10.0
add base64-js 1.5.1
add bare-url 2.3.2
add bare-stream 2.8.1
add bare-path 3.0.0
add bare-os 3.8.0
add bare-fs 4.5.5
add bare-events 2.8.2
add balanced-match 1.0.2
add b4a 1.8.0
add axobject-query 4.1.0
add axe-core 4.11.1
add aws-ssl-profiles 1.1.2
add available-typed-arrays 1.0.7
add async-function 1.0.0
add async 3.2.6
add ast-types-flow 0.0.8
add ast-types 0.16.1
add arraybuffer.prototype.slice 1.0.4
add array.prototype.tosorted 1.1.4
add array.prototype.flatmap 1.3.3
add array.prototype.flat 1.3.3
add array.prototype.findlastindex 1.2.6
add array.prototype.findlast 1.2.5
add array-includes 3.1.9
add array-buffer-byte-length 1.0.2
add aria-query 5.3.2
add aria-hidden 1.2.6
add argparse 2.0.1
add archiver-utils 2.1.0
add string_decoder 1.1.1
add safe-buffer 5.1.2
add readable-stream 2.3.8
add isarray 1.0.0
add archiver 5.3.2
add tar-stream 2.2.0
add ansis 4.2.0
add ansi-styles 4.3.0
add ansi-regex 6.2.2
add ajv-formats 3.0.1
add json-schema-traverse 1.0.0
add ajv 8.18.0
add ajv 6.14.0
add agent-base 7.1.4
add adler-32 1.3.1
add acorn-jsx 5.3.2
add acorn 8.16.0
add accepts 2.0.0
add @visx/vendor 4.0.0
add d3-time-format 4.1.0
add d3-time 3.1.0
add d3-format 3.1.0
add d3-delaunay 6.0.2
add d3-array 3.2.1
add @types/d3-time-format 2.1.0
add @types/d3-time 3.0.0
add @types/d3-shape 3.1.7
add @types/d3-scale 4.0.2
add @types/d3-interpolate 3.0.1
add @types/d3-format 3.0.1
add @types/d3-delaunay 6.0.1
add @types/d3-color 3.1.0
add @types/d3-array 3.0.3
add @visx/group 4.0.0
add @visx/geo 4.0.0
add @unrs/resolver-binding-darwin-arm64 1.11.1
add @typescript-eslint/visitor-keys 8.57.0
add eslint-visitor-keys 5.0.1
add @typescript-eslint/utils 8.57.0
add @typescript-eslint/typescript-estree 8.57.0
add semver 7.7.4
add minimatch 10.2.4
add brace-expansion 5.0.4
add balanced-match 4.0.4
add @typescript-eslint/types 8.57.0
add @typescript-eslint/type-utils 8.57.0
add @typescript-eslint/tsconfig-utils 8.57.0
add @typescript-eslint/scope-manager 8.57.0
add @typescript-eslint/project-service 8.57.0
add @typescript-eslint/parser 8.57.0
add @typescript-eslint/eslint-plugin 8.57.0
add ignore 7.0.5
add @types/yauzl 2.10.3
add @types/validate-npm-package-name 4.0.2
add @types/use-sync-external-store 0.0.6
add @types/topojson-specification 1.0.5
add @types/topojson-client 3.1.5
add @types/statuses 2.0.6
add @types/react-dom 19.2.3
add @types/react 19.2.14
add @types/papaparse 5.5.2
add @types/node 20.19.37
add @types/json5 0.0.29
add @types/json-schema 7.0.15
add @types/geojson 7946.0.16
add @types/estree 1.0.8
add @types/d3-timer 3.0.2
add @types/d3-time-format 2.3.4
add @types/d3-time 1.1.4
add @types/d3-shape 3.1.8
add @types/d3-scale-chromatic 3.1.0
add @types/d3-scale 4.0.9
add @types/d3-path 3.1.1
add @types/d3-interpolate 3.0.4
add @types/d3-geo 3.1.0
add @types/d3-format 1.4.5
add @types/d3-ease 3.0.2
add @types/d3-delaunay 6.0.4
add @types/d3-color 3.1.3
add @types/d3-array 3.2.2
add @tybys/wasm-util 0.10.1
add @ts-morph/common 0.27.0
add minimatch 10.2.4
add glob-parent 5.1.2
add fast-glob 3.3.3
add brace-expansion 5.0.4
add balanced-match 4.0.4
add @tootallnate/quickjs-emscripten 0.23.0
add @tailwindcss/postcss 4.2.1
add @tailwindcss/oxide-darwin-arm64 4.2.1
add @tailwindcss/oxide 4.2.1
add @tailwindcss/node 4.2.1
add @swc/helpers 0.5.15
add @standard-schema/utils 0.3.0
add @standard-schema/spec 1.1.0
add @sindresorhus/merge-streams 4.0.0
add @sec-ant/readable-stream 0.4.1
add @rtsao/scc 1.1.0
add @reduxjs/toolkit 2.11.2
add immer 11.1.4
add @react-spring/types 10.0.3
add @react-spring/shared 10.0.3
add @react-spring/rafz 10.0.3
add @react-spring/core 10.0.3
add @react-spring/animated 10.0.3
add @radix-ui/react-use-layout-effect 1.1.1
add @radix-ui/react-use-escape-keydown 1.1.1
add @radix-ui/react-use-effect-event 0.0.2
add @radix-ui/react-use-controllable-state 1.2.2
add @radix-ui/react-use-callback-ref 1.1.1
add @radix-ui/react-slot 1.2.3
add @radix-ui/react-primitive 2.1.3
add @radix-ui/react-presence 1.1.5
add @radix-ui/react-portal 1.1.9
add @radix-ui/react-id 1.1.1
add @radix-ui/react-focus-scope 1.1.7
add @radix-ui/react-focus-guards 1.1.3
add @radix-ui/react-dismissable-layer 1.1.11
add @radix-ui/react-dialog 1.1.15
add @radix-ui/react-context 1.1.2
add @radix-ui/react-compose-refs 1.1.2
add @radix-ui/primitive 1.1.3
add @puppeteer/browsers 2.13.0
add semver 7.7.4
add @open-draft/until 2.1.0
add @open-draft/logger 0.3.0
add @open-draft/deferred-promise 2.2.0
add @nolyfill/is-core-module 1.0.39
add @nodelib/fs.walk 1.2.8
add @nodelib/fs.stat 2.0.5
add @nodelib/fs.scandir 2.1.5
add @noble/hashes 1.8.0
add @noble/curves 1.9.7
add @noble/ciphers 1.3.0
add @nivo/voronoi 0.99.0
add @nivo/tooltip 0.99.0
add @react-spring/web 10.0.3
add @nivo/theming 0.99.0
add @nivo/text 0.99.0
add @react-spring/web 10.0.3
add @nivo/scatterplot 0.99.0
add @react-spring/web 10.0.3
add @nivo/scales 0.99.0
add @types/d3-time-format 3.0.4
add @nivo/pie 0.99.0
add @nivo/line 0.99.0
add @react-spring/web 10.0.3
add @nivo/legends 0.99.0
add @nivo/heatmap 0.99.0
add @react-spring/web 10.0.3
add @nivo/funnel 0.99.0
add @react-spring/web 10.0.3
add @nivo/core 0.99.0
add react-virtualized-auto-sizer 1.0.26
add @react-spring/web 10.0.3
add @nivo/colors 0.99.0
add @nivo/canvas 0.99.0
add @nivo/bar 0.99.0
add @react-spring/web 10.0.3
add @nivo/axes 0.99.0
add @react-spring/web 10.0.3
add @nivo/arcs 0.99.0
add @react-spring/web 10.0.3
add @nivo/annotations 0.99.0
add @react-spring/web 10.0.3
add @next/swc-darwin-arm64 16.1.6
add @next/eslint-plugin-next 16.1.6
add @next/env 16.1.6
add @napi-rs/wasm-runtime 0.2.12
add @mswjs/interceptors 0.41.3
add @modelcontextprotocol/sdk 1.27.1
add json-schema-traverse 1.0.0
add ajv 8.18.0
add @jridgewell/trace-mapping 0.3.31
add @jridgewell/sourcemap-codec 1.5.5
add @jridgewell/resolve-uri 3.1.2
add @jridgewell/remapping 2.3.5
add @jridgewell/gen-mapping 0.3.13
add @inquirer/type 3.0.10
add @inquirer/figures 1.0.15
add @inquirer/core 10.3.2
add @inquirer/confirm 5.1.21
add @inquirer/ansi 1.0.2
add @img/sharp-libvips-darwin-arm64 1.2.4
add @img/sharp-darwin-arm64 0.34.5
add @img/colour 1.1.0
add @humanwhocodes/retry 0.4.3
add @humanwhocodes/module-importer 1.0.1
add @humanfs/node 0.16.7
add @humanfs/core 0.19.1
add @hono/node-server 1.19.11
add @floating-ui/utils 0.2.11
add @floating-ui/react-dom 2.1.8
add @floating-ui/dom 1.7.6
add @floating-ui/core 1.7.5
add @fast-csv/parse 4.3.6
add @types/node 14.18.63
add @fast-csv/format 4.3.5
add @types/node 14.18.63
add @eslint/plugin-kit 0.4.1
add @eslint/object-schema 2.1.7
add @eslint/js 9.39.4
add @eslint/eslintrc 3.3.5
add @eslint/core 0.17.0
add @eslint/config-helpers 0.4.2
add @eslint/config-array 0.21.2
add @eslint-community/regexpp 4.12.2
add @eslint-community/eslint-utils 4.9.1
add eslint-visitor-keys 3.4.3
add @esbuild/darwin-arm64 0.27.3
add @emnapi/wasi-threads 1.1.0
add @emnapi/runtime 1.8.1
add @emnapi/core 1.8.1
add @ecies/ciphers 0.2.5
add @dotenvx/dotenvx 1.54.1
add which 4.0.0
add strip-final-newline 2.0.0
add signal-exit 3.0.7
add picomatch 4.0.3
add onetime 5.1.2
add npm-run-path 4.0.1
add isexe 3.1.5
add is-stream 2.0.1
add human-signals 2.1.0
add get-stream 6.0.1
add fdir 6.5.0
add execa 5.1.1
add commander 11.1.0
add @base-ui/utils 0.2.5
add @base-ui/react 1.2.0
add @babel/types 7.29.0
add @babel/traverse 7.29.0
add @babel/template 7.28.6
add @babel/runtime 7.28.6
add @babel/preset-typescript 7.28.5
add @babel/plugin-transform-typescript 7.28.6
add @babel/plugin-transform-modules-commonjs 7.28.6
add @babel/plugin-syntax-typescript 7.28.6
add @babel/plugin-syntax-jsx 7.28.6
add @babel/parser 7.29.0
add @babel/helpers 7.28.6
add @babel/helper-validator-option 7.27.1
add @babel/helper-validator-identifier 7.28.5
add @babel/helper-string-parser 7.27.1
add @babel/helper-skip-transparent-expression-wrappers 7.27.1
add @babel/helper-replace-supers 7.28.6
add @babel/helper-plugin-utils 7.28.6
add @babel/helper-optimise-call-expression 7.27.1
add @babel/helper-module-transforms 7.28.6
add @babel/helper-module-imports 7.28.6
add @babel/helper-member-expression-to-functions 7.28.5
add @babel/helper-globals 7.28.0
add @babel/helper-create-class-features-plugin 7.28.6
add @babel/helper-compilation-targets 7.28.6
add @babel/helper-annotate-as-pure 7.27.3
add @babel/generator 7.29.1
add @babel/core 7.29.0
add @babel/compat-data 7.29.0
add @babel/code-frame 7.29.0
add @antfu/ni 25.0.0
add @alloc/quick-lru 5.2.0

added 931 packages in 460ms

246 packages are looking for funding
  run `npm fund` for details
```

Command:

```text
node --import tsx --test packages/runtime-contract/src/index.test.ts
```

Output (exit 0):

```text
✔ canonical special dashboards resolve before generic advertising (0.459917ms)
✔ isolated runtimes fail closed for another dashboard family (0.057792ms)
✔ public route ownership preserves current paths (0.052792ms)
✔ Zaruku production authority is immutable (0.541583ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 147.403292
```

Command:

```text
npm run typecheck
```

Output (exit 0):

```text

> dashboard-next@0.1.0 typecheck
> tsc --noEmit

```

Command:

```text
git diff --check
```

Output (exit 0): no output.

### Files changed

- `package-lock.json`: added the root workspace declaration, the `@reportingdash/runtime-contract` symlink entry, and its workspace package metadata.
- `.superpowers/sdd/runtime-isolation-task-1-report.md`: appended this review-fix evidence.

### Self-review

- The lockfile is the only implementation file changed; package scripts, dependencies, and runtime scope behavior are untouched.
- The workspace link resolves to the existing local package and `npm ci --dry-run --ignore-scripts --offline` now accepts the manifest/lockfile pair.
- No generated dependency versions or unrelated lockfile entries changed.

### Commit

Pending: `fix: add runtime contract workspace lock entries`.
