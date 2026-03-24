import { NextResponse } from "next/server";
import { VIEWER_PORTAL_SESSION_COOKIE } from "@/lib/access-auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(VIEWER_PORTAL_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
  return response;
}

