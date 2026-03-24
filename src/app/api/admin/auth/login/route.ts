import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  cookieOptions,
  createAdminSession,
  isValidAdminCredentials,
} from "@/lib/access-auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  if (!isValidAdminCredentials(email, password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_SESSION_COOKIE, createAdminSession(email), cookieOptions(60 * 60 * 24 * 30));
  return response;
}

