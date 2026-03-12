import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { getSchemaMetaByPlatform } from "@/lib/schema-registry";
import { loadSchema } from "@/lib/schema-parser";

function qualifyFilter(filter: string): string {
  if (filter.includes(".")) return filter;
  return filter.replace(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)/, "c.$1");
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const platform = String(url.searchParams.get("platform") ?? "")
      .trim()
      .toLowerCase();
    const search = String(url.searchParams.get("search") ?? "").trim();

    if (!platform) {
      return NextResponse.json({ error: "platform query param is required" }, { status: 400 });
    }

    const schemaMeta = getSchemaMetaByPlatform(platform);
    if (!schemaMeta) {
      return NextResponse.json({ campaigns: [], total: 0, message: "Platform schema not found" });
    }

    const schema = loadSchema(schemaMeta.schema_file);
    if (schema.source !== "mysql" || !schema.tables) {
      return NextResponse.json({ campaigns: [], total: 0, message: "Platform is not mysql source" });
    }

    const campaigns = schema.tables.campaigns;
    const wheres: string[] = [];
    const params: Array<string | number | Date | null> = [];

    if (campaigns.filter) {
      wheres.push(qualifyFilter(campaigns.filter));
    }
    if (search) {
      wheres.push(`c.${campaigns.name_col} LIKE ?`);
      params.push(`%${search}%`);
    }

    const whereSql = wheres.length ? ` WHERE ${wheres.join(" AND ")}` : "";

    const sql = `
      SELECT
        c.${campaigns.id_col} as id,
        c.${campaigns.name_col} as name
      FROM ${campaigns.table} c
      ${whereSql}
      ORDER BY c.${campaigns.name_col}
      LIMIT 200
    `;

    const countSql = `
      SELECT COUNT(*) as total
      FROM ${campaigns.table} c
      ${whereSql}
    `;

    const [rows] = await pool.execute<RowDataPacket[]>(sql, params);
    const [countRows] = await pool.execute<RowDataPacket[]>(countSql, params);

    const result = rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      platform,
    }));

    return NextResponse.json({
      campaigns: result,
      total: Number(countRows[0]?.total ?? result.length),
    });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (err.code === "ER_NO_SUCH_TABLE") {
      return NextResponse.json({
        campaigns: [],
        total: 0,
        message: "No campaigns table yet for this platform. Run ETL first.",
      });
    }

    return NextResponse.json(
      { error: "Failed to load campaigns", details: err.message ?? String(error) },
      { status: 500 },
    );
  }
}
