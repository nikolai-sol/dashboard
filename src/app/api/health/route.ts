import { NextResponse } from "next/server";
import pool from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  const startedAt = Date.now();

  try {
    await pool.execute("SELECT 1 AS ok");

    return NextResponse.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: "connected",
      db_latency_ms: Date.now() - startedAt,
      uptime_seconds: Math.floor(process.uptime()),
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "error",
        timestamp: new Date().toISOString(),
        database: "disconnected",
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 503 },
    );
  }
}
