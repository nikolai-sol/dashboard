import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { ADMIN_SESSION_COOKIE, parseCookieValue, verifyAdminSession } from "@/lib/access-auth";
import {
  BindingValidationError,
  replaceEffectiveBindings,
  type EffectiveBindingInput,
} from "@/lib/media-plan-binding-store";

type BindingsRequestBody = {
  bindings?: unknown;
};

function normalizeBindings(value: unknown): EffectiveBindingInput[] {
  if (!Array.isArray(value)) throw new BindingValidationError("bindings must be an array");
  return value.map((item, index) => {
    const input = (item ?? {}) as Partial<EffectiveBindingInput>;
    const channel = String(input.channel ?? "").trim();
    const lineKey = String(input.line_key ?? channel).trim();
    const campaignId = Number(input.canonical_campaign_id);
    const effectiveFrom = input.effective_from === null
      ? null
      : String(input.effective_from ?? "").trim();
    const effectiveTo = input.effective_to === null
      ? null
      : String(input.effective_to ?? "").trim();
    if (!channel || !lineKey || !Number.isSafeInteger(campaignId) || campaignId <= 0) {
      throw new BindingValidationError(`binding ${index + 1} has invalid identity`);
    }
    if ((effectiveFrom !== null && !effectiveFrom) || (effectiveTo !== null && !effectiveTo)) {
      throw new BindingValidationError(`binding ${index + 1} has invalid effective period`);
    }
    return {
      line_key: lineKey,
      channel,
      canonical_campaign_id: campaignId,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
    };
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const { id } = await Promise.resolve(context.params);
  const dashboardId = Number(id);
  if (!Number.isSafeInteger(dashboardId) || dashboardId <= 0) {
    return NextResponse.json({ error: "Invalid dashboard id" }, { status: 400 });
  }

  const actor = verifyAdminSession(
    parseCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE),
  )?.email ?? null;
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as BindingsRequestBody;
  let bindings: EffectiveBindingInput[];
  try {
    bindings = normalizeBindings(body.bindings);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid bindings" },
      { status: 400 },
    );
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const resolved = await replaceEffectiveBindings(conn, dashboardId, actor, bindings);
    await conn.commit();
    return NextResponse.json({
      message: "Bindings updated",
      total: resolved.length,
    });
  } catch (error) {
    await conn.rollback();
    return NextResponse.json(
      { error: "Failed to save bindings", details: error instanceof Error ? error.message : String(error) },
      { status: error instanceof BindingValidationError ? 400 : 500 },
    );
  } finally {
    conn.release();
  }
}
