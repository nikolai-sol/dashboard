export const abbott = Object.freeze({
  scope: "abbott",
  releaseBranch: "release/abbott",
  appName: "dashboard-abbott",
  port: 3004,
  appDir: "/var/www/dashboard-abbott",
  lockDir: "/var/www/.dashboard-abbott-deploy.lock",
  assetPrefix: "/_next-abbott",
});

export const RUNTIME_MANIFESTS = Object.freeze({ abbott });
