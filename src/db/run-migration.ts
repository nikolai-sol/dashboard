import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim().replace(/^['\"]|['\"]$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function run() {
  const localEnv = path.join(process.cwd(), ".env.local");
  const rootEnv = path.join(process.cwd(), "..", ".env");
  loadEnvFile(localEnv);
  loadEnvFile(rootEnv);

  const host = process.env.DB_HOST ?? process.env.MYSQL_HOST;
  const port = Number(process.env.DB_PORT ?? process.env.MYSQL_PORT ?? 3306);
  const user = process.env.DB_USER ?? process.env.MYSQL_USER;
  const password = process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD;
  const database = process.env.DB_NAME ?? process.env.MYSQL_DB ?? "report_bd";

  if (!host || !user || !database) {
    throw new Error("Missing DB connection env values (host/user/database)");
  }

  const migrationsDir = path.join(process.cwd(), "src", "db", "migrations");
  const migrationFiles = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, "en"));

  const connection = await mysql.createConnection({
    host,
    port,
    user,
    password,
    database,
    multipleStatements: true,
  });

  try {
    for (const file of migrationFiles) {
      const sqlPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(sqlPath, "utf-8");
      await connection.query(sql);
      console.log(`Migration ${file} completed successfully.`);
    }
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
