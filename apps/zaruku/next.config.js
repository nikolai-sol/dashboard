// eslint-disable-next-line @typescript-eslint/no-require-imports -- Next.js loads this configuration as CommonJS.
const path = require("node:path");

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  output: "standalone",
  distDir: ".next-zaruku",
  assetPrefix: "/_next-zaruku",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
};
