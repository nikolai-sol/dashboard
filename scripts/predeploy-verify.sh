#!/bin/bash
set -euo pipefail
source "$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/deployment-stage-timing.sh"
finish_predeploy_timing() {
  local status=$?
  trap - EXIT
  stage_timing_end "$status"
  exit "$status"
}
trap finish_predeploy_timing EXIT

stage_timing_begin predeploy.tests
npm test
stage_timing_end 0

stage_timing_begin predeploy.runtime-contract
node --import tsx --test packages/runtime-contract/src/index.test.ts
stage_timing_end 0

stage_timing_begin predeploy.deploy-source
npm run test:deploy-source
stage_timing_end 0

stage_timing_begin predeploy.zaruku-production-shadow
npm run test:zaruku-production-shadow
stage_timing_end 0

stage_timing_begin predeploy.zaruku-exact-path
npm run test:zaruku-exact-path-cutover
stage_timing_end 0

stage_timing_begin predeploy.release-runtime
npm run test:release-runtime
stage_timing_end 0

stage_timing_begin predeploy.zaruku-tests
node scripts/run-node-tests.mjs apps/zaruku/src
stage_timing_end 0

stage_timing_begin predeploy.runtime-artifact-policy
node --test scripts/runtime-artifact-policy.test.mjs
stage_timing_end 0

stage_timing_begin predeploy.zaruku-artifact
npm --workspace apps/zaruku run verify:artifact
stage_timing_end 0

stage_timing_begin predeploy.zaruku-boot
npm --workspace apps/zaruku run verify:boot
stage_timing_end 0

stage_timing_begin predeploy.zaruku-shadow-parity
bash scripts/verify-zaruku-shadow.test.sh
stage_timing_end 0

stage_timing_begin predeploy.abbott-wiring
npm run test:abbott-contract-wiring
stage_timing_end 0

stage_timing_begin predeploy.public-assets
npm run security:public-assets
stage_timing_end 0

stage_timing_begin predeploy.typecheck
npm run typecheck
stage_timing_end 0

stage_timing_begin predeploy.zaruku-typecheck
npm exec -- tsc --noEmit -p apps/zaruku/tsconfig.json
stage_timing_end 0

stage_timing_begin predeploy.lint
npm run lint
stage_timing_end 0

stage_timing_begin predeploy.build
npm run build
stage_timing_end 0

stage_timing_begin predeploy.preview-builder
npm run preview-builder:test
stage_timing_end 0
