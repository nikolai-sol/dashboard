import { NextResponse } from "next/server";

const collectorOwnedResponse = {
  error: "Manual data previews are unavailable before canonical publication",
  publication_status: "unpublished_preview",
};

export async function GET() {
  return NextResponse.json(collectorOwnedResponse, { status: 409 });
}

export async function POST() {
  return NextResponse.json(collectorOwnedResponse, { status: 409 });
}
