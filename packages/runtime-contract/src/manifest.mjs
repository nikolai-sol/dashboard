export const RUNTIME_MANIFESTS = Object.freeze({
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
