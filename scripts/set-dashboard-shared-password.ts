import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import pool from "../src/lib/db";
import { rotateSharedDashboardPassword } from "../src/lib/dashboard-shared-access";
import {
  isSharedPasswordClient,
  normalizeSharedPasswordClientId,
  validateSharedPasswordChange,
} from "../src/lib/shared-password-policy";

type DashboardLookupDatabase = {
  execute(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
};

export function parseSeedClientId(args: string[]) {
  if (args.length !== 2 || args[0] !== "--client-id" || !isSharedPasswordClient(args[1])) {
    throw new Error("Usage: --client-id abbott|zaruku");
  }
  return normalizeSharedPasswordClientId(args[1]);
}

export async function resolveActiveDashboardIdByClientId(
  clientId: string,
  database: DashboardLookupDatabase = pool as DashboardLookupDatabase,
) {
  try {
    const [result] = await database.execute(
      `SELECT id
       FROM dashboards
       WHERE client_id = ?
         AND is_active = TRUE
       LIMIT 2`,
      [clientId],
    );
    const rows = Array.isArray(result) ? result : [];
    if (rows.length !== 1) throw new Error("Unexpected dashboard count");

    const dashboardId = (rows[0] as { id?: unknown }).id;
    if (!Number.isSafeInteger(dashboardId) || Number(dashboardId) <= 0) {
      throw new Error("Invalid dashboard ID");
    }
    return Number(dashboardId);
  } catch {
    throw new Error("Unable to resolve active dashboard");
  }
}

async function main() {
  const clientId = parseSeedClientId(process.argv.slice(2));
  const password = readFileSync(0, "utf8").replace(/[\r\n]+$/, "");
  const validation = validateSharedPasswordChange({
    new_password: password,
    confirm_password: password,
  });
  if (!validation.ok) throw new Error(validation.error);

  const dashboardId = await resolveActiveDashboardIdByClientId(clientId);
  await rotateSharedDashboardPassword(dashboardId, validation.password, "production-seed");
  process.stdout.write("Shared dashboard password configured.\n");
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entrypoint) {
  void main().catch(() => {
    process.stderr.write("Unable to configure shared dashboard password.\n");
    process.exitCode = 1;
  });
}
