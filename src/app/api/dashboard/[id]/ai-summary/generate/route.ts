import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import { projectAbbottDashboardData } from "@/lib/abbott-data-projection";
import { isDashboardAccessAuthorized } from "@/lib/dashboard-access";
import {
  buildDashboardAiSummarySnapshot,
  generateDashboardAiSummary,
} from "@/lib/dashboard-ai-summary";
import { loadDashboardData } from "@/lib/dashboard-data-loader";

type DashboardConfigRow = RowDataPacket & {
  id: number;
  config: string | Record<string, unknown> | null;
};

const PRIVATE_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

function privateJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: { ...init?.headers, ...PRIVATE_RESPONSE_HEADERS },
  });
}

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

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await Promise.resolve(context.params);
    const access = await isDashboardAccessAuthorized(request, id);
    if (!access.context) {
      return privateJson({ error: "Dashboard not found" }, { status: 404 });
    }
    if (!access.authorized) {
      return privateJson(
        {
          error: "Authentication required",
          auth_required: true,
          dashboard: {
            id: access.context.id,
            client_id: access.context.client_id,
            client_name: access.context.client_name,
            dashboard_name: access.context.dashboard_name,
            auth_mode: access.context.auth_mode,
          },
        },
        { status: 401 },
      );
    }

    const { dashboard_id, data: loadedData, ai_summary_enabled } = await loadDashboardData(request, id);
    const data = projectAbbottDashboardData(loadedData, access.audience);
    if (!ai_summary_enabled) {
      return privateJson(
        { error: "AI summary is disabled for this dashboard" },
        { status: 409 },
      );
    }

    const candidate = await generateDashboardAiSummary(data);
    if (candidate.status !== "ready") {
      return privateJson(
        { error: "AI summary generation did not produce a ready summary" },
        { status: candidate.status === "unavailable" ? 409 : 502 },
      );
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute<DashboardConfigRow[]>(
        "SELECT id, config FROM dashboards WHERE id = ? LIMIT 1",
        [dashboard_id],
      );
      const row = rows[0];
      if (!row) {
        await conn.rollback();
        return privateJson({ error: "Dashboard not found" }, { status: 404 });
      }

      const config = parseConfig(row.config);
      if (!Boolean(config.show_ai_summary ?? false)) {
        await conn.rollback();
        return privateJson(
          { error: "AI summary is disabled for this dashboard" },
          { status: 409 },
        );
      }

      config.ai_summary_snapshot = buildDashboardAiSummarySnapshot(
        data,
        candidate,
        "public_dashboard",
      );

      await conn.execute<ResultSetHeader>(
        "UPDATE dashboards SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        [JSON.stringify(config), dashboard_id],
      );
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      console.error("AI summary persistence error:", error);
      return privateJson(
        { error: "Failed to persist AI summary snapshot" },
        { status: 500 },
      );
    } finally {
      conn.release();
    }

    return privateJson({
      enabled: true,
      effective_summary: candidate,
      snapshot_summary: candidate,
      has_snapshot: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Dashboard not found") {
      return privateJson({ error: "Dashboard not found" }, { status: 404 });
    }
    console.error("AI summary generation error:", error);
    return privateJson(
      { error: "Failed to generate AI summary" },
      { status: 500 },
    );
  }
}
