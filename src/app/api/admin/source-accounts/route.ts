import { NextResponse } from "next/server";
import {
  listSourceAccountCollectionRows,
  saveSourceAccountCollectionSettings,
} from "@/lib/admin-source-accounts";
import type { SourceAccountCollectionSettingInput } from "@/lib/admin-ui-types";

function normalizeInputRows(payload: unknown): SourceAccountCollectionSettingInput[] {
  if (!Array.isArray(payload)) {
    return [];
  }
  return payload.map((item) => {
    const row = typeof item === "object" && item ? (item as Record<string, unknown>) : {};
    return {
      source_key: String(row.source_key ?? "").trim(),
      platform_account_id: String(row.platform_account_id ?? "").trim(),
      is_active: Boolean(row.is_active),
      cron_enabled: Boolean(row.cron_enabled),
      collection_mode:
        typeof row.collection_mode === "string" && row.collection_mode.trim()
          ? (row.collection_mode.trim() as SourceAccountCollectionSettingInput["collection_mode"])
          : null,
    };
  });
}

export async function GET() {
  try {
    const rows = await listSourceAccountCollectionRows();
    return NextResponse.json({ rows, total: rows.length });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load source account collection settings",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { rows?: unknown };
    const rows = normalizeInputRows(body?.rows);
    await saveSourceAccountCollectionSettings(rows);
    const refreshedRows = await listSourceAccountCollectionRows();
    return NextResponse.json({ rows: refreshedRows, total: refreshedRows.length });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to save source account collection settings",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
