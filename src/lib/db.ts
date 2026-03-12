import mysql from "mysql2/promise";

function getNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const host = process.env.DB_HOST ?? process.env.MYSQL_HOST;
const port = getNumber(process.env.DB_PORT ?? process.env.MYSQL_PORT, 3306);
const user = process.env.DB_USER ?? process.env.MYSQL_USER;
const password = process.env.DB_PASSWORD ?? process.env.MYSQL_PASSWORD;
const database = process.env.DB_NAME ?? process.env.MYSQL_DB ?? "report_bd";

declare global {
  var __dashboardMysqlPool: mysql.Pool | undefined;
}

const pool =
  global.__dashboardMysqlPool ??
  mysql.createPool({
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
  });

if (!global.__dashboardMysqlPool) {
  global.__dashboardMysqlPool = pool;
}

export default pool;
