#!/bin/bash
set -euo pipefail

npm test
npm run test:deploy-source
npm run test:release-runtime
npm run test:abbott-contract-wiring
npm run test:abbott-contract
npm run security:public-assets
npm run typecheck
npm run lint
npm run build
npm run preview-builder:test
