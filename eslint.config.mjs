import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["apps/*/next.config.js"],
    rules: {
      // Next's CommonJS configuration can load Node built-ins with require.
      "@typescript-eslint/no-require-imports": ["error", { allow: ["^node:"] }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "apps/**/.next-zaruku/**",
    "out/**",
    "build/**",
    ".worktrees/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
