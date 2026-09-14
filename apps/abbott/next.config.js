const path = require("node:path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  distDir: ".next-abbott",
  assetPrefix: "/_next-abbott",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
};

module.exports = nextConfig;
