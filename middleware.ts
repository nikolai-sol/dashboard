import { NextRequest, NextResponse } from "next/server";

const ADMIN_SESSION_COOKIE = "dashboard_admin_session";

function getAuthSecret() {
  return (
    process.env.DASHBOARD_AUTH_SECRET ||
    process.env.DB_PASSWORD ||
    process.env.MYSQL_PASSWORD ||
    "dashboard-dev-secret"
  );
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

async function verifyAdminSession(token: string | undefined) {
  if (!token || !token.includes(".")) return false;
  const [payloadPart, signaturePart] = token.split(".", 2);
  if (!payloadPart || !signaturePart) return false;

  const secretBytes = new TextEncoder().encode(getAuthSecret());
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadPart));
  const expected = new Uint8Array(signature);
  const actual = fromBase64Url(signaturePart);
  if (!equalBytes(expected, actual)) return false;

  try {
    const payloadBytes = fromBase64Url(payloadPart);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
      type?: string;
      exp?: number;
      email?: string;
    };
    return Boolean(payload.type === "admin" && payload.email && payload.exp && payload.exp > Date.now() / 1000);
  } catch {
    return false;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isAdminPage = pathname.startsWith("/admin");
  const isAdminApi = pathname.startsWith("/api/admin");
  const isAuthRoute = pathname === "/admin/login" || pathname.startsWith("/api/admin/auth/");

  if ((!isAdminPage && !isAdminApi) || isAuthRoute) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const authorized = await verifyAdminSession(token);
  if (authorized) {
    return NextResponse.next();
  }

  if (isAdminApi) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
