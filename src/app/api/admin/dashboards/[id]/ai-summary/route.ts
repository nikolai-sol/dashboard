import { NextResponse } from "next/server";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import pool from "@/lib/db";
import {
  ADMIN_SESSION_COOKIE,
  parseCookieValue,
  verifyAdminSession,
} from "@/lib/access-auth";
import {
  buildDashboardAiSummaryCacheKey,
  buildDashboardAiSummaryFromOverrideText,
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

async function loadEffectiveSummary(request: Request, dashboardId: string) {
  const {
    data,
    ai_summary_enabled,
    ai_summary_override,
    ai_summary_override_text,
  } = await loadDashboardData(request, dashboardId);

  if (!ai_summary_enabled) {
    return {
      enabled: false,
      source: "disabled" as const,
      override_text: ai_summary_override_text ?? null,
      effective_summary: null,
    };
  }

  if (ai_summary_override) {
    return {
      enabled: true,
      source: "override" as const,
      override_text: ai_summary_override_text ?? null,
      effective_summary: ai_summary_override,
    };
  }

  const effectiveSummary = await generateDashboardAiSummary(data, {
    cacheKey: buildDashboardAiSummaryCacheKey(request, dashboardId),
  });

  return {
    enabled: true,
    source: "generated" as const,
    override_text: null,
    effective_summary: effectiveSummary,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await Promise.resolve(context.params);
    const dashboardId = getDashboardId(id);
    if (dashboardId === null) {
      return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
    }

    const summary = await loadEffectiveSummary(request, String(dashboardId));
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Dashboard not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to load AI summary authoring state", details: message },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(context.params);
  const dashboardId = getDashboardId(id);
  if (dashboardId === null) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as { override_text?: unknown } | null;
  const overrideText = String(body?.override_text ?? "").trim();
  if (!overrideText) {
    return NextResponse.json({ error: "override_text is required" }, { status: 400 });
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

    const updatedAt = new Date().toISOString();
    config.ai_summary_authoring = {
      override_text: overrideText,
      updated_at: updatedAt,
      updated_by: getAdminEmailFromRequest(request),
    };

    await conn.execute<ResultSetHeader>(
      "UPDATE dashboards SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [JSON.stringify(config), dashboardId],
    );

    await conn.commit();

    return NextResponse.json({
      enabled: true,
      source: "override",
      override_text: overrideText,
      effective_summary: buildDashboardAiSummaryFromOverrideText(overrideText, updatedAt),
    });
  } catch (error) {
    await conn.rollback();
    return NextResponse.json(
      { error: "Failed to save AI summary override", details: String(error) },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(context.params);
  const dashboardId = getDashboardId(id);
  if (dashboardId === null) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
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
    delete config.ai_summary_authoring;

    await conn.execute<ResultSetHeader>(
      "UPDATE dashboards SET config = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [JSON.stringify(config), dashboardId],
    );

    await conn.commit();

    const summary = await loadEffectiveSummary(request, String(dashboardId));
    return NextResponse.json(summary);
  } catch (error) {
    await conn.rollback();
    return NextResponse.json(
      { error: "Failed to clear AI summary override", details: String(error) },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}
