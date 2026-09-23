export const RUNTIME_MANIFESTS = Object.freeze({
  abbott: Object.freeze({
    scope: "abbott",
    releaseBranch: "release/abbott",
    appName: "dashboard-abbott",
    port: 3004,
    appDir: "/var/www/dashboard-abbott",
    lockDir: "/var/www/.dashboard-abbott-deploy.lock",
    assetPrefix: "/_next-abbott",
  }),
  zaruku: Object.freeze({
    scope: "zaruku",
    releaseBranch: "release/zaruku",
    appName: "dashboard-zaruku",
    port: 3002,
    appDir: "/var/www/dashboard-zaruku",
    lockDir: "/var/www/.dashboard-zaruku-deploy.lock",
    assetPrefix: "/_next-zaruku",
  }),
});
