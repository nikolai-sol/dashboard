import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import {
  ADMIN_SESSION_COOKIE,
  parseCookieValue,
  verifyAdminSession,
} from "@/lib/access-auth";
import {
  buildDashboardAiSummarySnapshot,
  generateDashboardAiSummary,
} from "@/lib/dashboard-ai-summary";
import { loadDashboardData } from "@/lib/dashboard-data-loader";

type DashboardConfigRow = RowDataPacket & {
  id: number;
  config: string | Record<string, unknown> | null;
};

function parseConfig(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return {};
}

function getDashboardId(rawId: string): number | null {
  const dashboardId = Number(rawId);
  return Number.isFinite(dashboardId) ? dashboardId : null;
}

function getAdminEmailFromRequest(request: Request): string | null {
  const token = parseCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE);
  return verifyAdminSession(token)?.email ?? null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await Promise.resolve(context.params);
    const dashboardId = getDashboardId(id);
    if (dashboardId === null) {
      return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
    }

    const {
      data,
      ai_summary_enabled,
      ai_summary_override_text,
      ai_summary_override,
      ai_summary_snapshot,
    } = await loadDashboardData(
      request,
      String(dashboardId),
      "manager",
    );

    if (!ai_summary_enabled) {
      return NextResponse.json(
        { error: "AI summary authoring is disabled for this dashboard" },
        { status: 409 },
      );
    }

    const candidate = await generateDashboardAiSummary(data);
    if (candidate.status !== "ready") {
      return NextResponse.json(
        {
          error: "AI summary generation did not produce a ready summary",
          candidate,
        },
        { status: candidate.status === "unavailable" ? 409 : 502 },
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [rows] = await conn.execute<DashboardConfigRow[]>(
        "SELECT id, config FROM dashboards WHERE id = ? LIMIT 1",
        [dashboardId],
      );
      const row = rows[0];
      if (!row) {
        await conn.rollback();
        return NextResponse.json({ error: "Dashboard not found" }, { status: 404 });
      }

      const config = parseConfig(row.config);
      if (!Boolean(config.show_ai_summary ?? false)) {
        await conn.rollback();
        return NextResponse.json(
          { error: "AI summary authoring is disabled for this dashboard" },
          { status: 409 },
        );
      }

      config.ai_summary_snapshot = buildDashboardAiSummarySnapshot(
        data,
        candidate,
        getAdminEmailFromRequest(request),
      );

      await conn.execute<ResultSetHeader>(
        "UPDATE dashboards SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [JSON.stringify(config), dashboardId],
      );

      await conn.commit();
    } catch (error) {
      await conn.rollback();
      return NextResponse.json(
        { error: "Failed to persist AI summary snapshot", details: String(error) },
        { status: 500 },
      );
    } finally {
      conn.release();
    }

    return NextResponse.json({
      enabled: true,
      source: ai_summary_override ? "override" : "snapshot",
      override_text: ai_summary_override_text ?? null,
      effective_summary: ai_summary_override ?? candidate,
      snapshot_summary: candidate,
      has_snapshot: true,
      previous_snapshot_summary: ai_summary_snapshot ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Dashboard not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to generate AI summary candidate", details: message },
      { status: 500 },
    );
  }
}
