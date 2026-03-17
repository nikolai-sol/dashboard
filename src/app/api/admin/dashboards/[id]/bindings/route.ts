import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { replaceMediaPlanBindings, type MediaPlanBindingInput } from "@/lib/admin-dashboards";

type BindingsRequestBody = {
  bindings?: unknown;
};

function normalizeBindings(value: unknown): MediaPlanBindingInput[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const input = (item ?? {}) as Partial<MediaPlanBindingInput>;
      const channel = String(input.channel ?? "").trim();
      const sourceKey = String(input.source_key ?? "").trim().toLowerCase();
      const campaignId = String(input.platform_campaign_id ?? "").trim();
      if (!channel || !sourceKey || !campaignId) return null;
      return {
        channel,
        source_key: sourceKey,
        platform_campaign_id: campaignId,
      };
    })
    .filter((item): item is MediaPlanBindingInput => Boolean(item));
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(context.params);
  const dashboardId = Number(id);
  if (!Number.isFinite(dashboardId)) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as BindingsRequestBody;
  const bindings = normalizeBindings(body.bindings);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await replaceMediaPlanBindings(conn, dashboardId, bindings);
    await conn.commit();
    return NextResponse.json({
      message: "Bindings updated",
      total: bindings.length,
    });
  } catch (error) {
    await conn.rollback();
    return NextResponse.json(
      { error: "Failed to save bindings", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  } finally {
    conn.release();
  }
}
