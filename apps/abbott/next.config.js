// Next loads this configuration as CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  distDir: ".next-abbott",
  assetPrefix: "/_next-abbott",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/*": ["./src/schemas/yandex_metrika.yaml"],
  },
  outputFileTracingExcludes: {
    "/*": ["./src/**/*.test.ts", "./src/**/*.test.tsx", "./src/**/*fixture*.ts"],
  },
  poweredByHeader: false,
};

module.exports = nextConfig;
