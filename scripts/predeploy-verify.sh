#!/bin/bash
set -euo pipefail

npm test
node --import tsx --test packages/runtime-contract/src/index.test.ts
npm run test:deploy-source
npm run test:release-runtime
node --import tsx --test 'apps/zaruku/src/**/*.test.ts'
node --test scripts/runtime-artifact-policy.test.mjs
npm --workspace apps/zaruku run verify:artifact
npm --workspace apps/zaruku run verify:boot
bash scripts/verify-zaruku-shadow.test.sh
npm run test:abbott-contract-wiring
npm run test:abbott-contract
npm run security:public-assets
npm run typecheck
npm exec -- tsc --noEmit -p apps/zaruku/tsconfig.json
npm run lint
npm run build
npm run preview-builder:test
