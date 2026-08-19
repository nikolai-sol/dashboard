import { NextResponse } from "next/server";
import { ADMIN_SESSION_COOKIE, parseCookieValue, verifyAdminSession } from "@/lib/access-auth";
import { loadAdvertisingBindingDiagnostics } from "@/lib/advertising-binding-diagnostics";

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  const actor = verifyAdminSession(
    parseCookieValue(request.headers.get("cookie"), ADMIN_SESSION_COOKIE),
  )?.email ?? null;
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await Promise.resolve(context.params);
  const dashboardId = Number(id);
  const url = new URL(request.url);
  const from = String(url.searchParams.get("from") ?? "").trim();
  const to = String(url.searchParams.get("to") ?? "").trim();
  if (!Number.isSafeInteger(dashboardId) || dashboardId <= 0 || !isIsoDate(from) || !isIsoDate(to) || from > to) {
    return NextResponse.json({ error: "Invalid dashboard or date range" }, { status: 400 });
  }

  try {
    const diagnostics = await loadAdvertisingBindingDiagnostics(dashboardId, from, to);
    return NextResponse.json({ dashboard_id: dashboardId, period: { from, to }, ...diagnostics });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load binding diagnostics", details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
