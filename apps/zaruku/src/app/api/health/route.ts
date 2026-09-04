import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    { ok: true, scope: "zaruku" },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
