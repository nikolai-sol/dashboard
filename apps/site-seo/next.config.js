// The build wrapper supplies all site values from a validated SiteProfile.
// No site-specific IDs or credentials belong in this app-local configuration.
const path = require("node:path");

function value(name, fallback) {
  const value = process.env[name] || fallback;
  if (!/^[a-z0-9_./-]+$/.test(value)) throw new Error(`invalid ${name}`);
  return value;
}

/** @type {import('next').NextConfig} */
module.exports = {
  reactStrictMode: true,
  output: "standalone",
  distDir: value("SITE_SEO_BUILD_OUTPUT_DIR", ".next-medroche"),
  assetPrefix: value("SITE_SEO_ASSET_PREFIX", "/_next-medroche"),
  outputFileTracingRoot: path.join(__dirname, "../.."),
  poweredByHeader: false,
};
