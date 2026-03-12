import { NextResponse } from "next/server";
import { listSchemaMetas } from "@/lib/schema-registry";

export async function GET() {
  try {
    const platforms = listSchemaMetas();
    return NextResponse.json({ platforms });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load platform schemas", details: String(error) },
      { status: 500 },
    );
  }
}
