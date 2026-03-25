import { NextResponse } from "next/server";
import { VIEWER_PORTAL_SESSION_COOKIE } from "@/lib/access-auth";

function getPublicRootUrl(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}/`;
  }
  const requestUrl = new URL(request.url);
  return new URL("/", requestUrl).toString();
}

function clearViewerPortalSession(request: Request) {
  const response = NextResponse.redirect(getPublicRootUrl(request), { status: 303 });
  response.cookies.set(VIEWER_PORTAL_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "none",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
  return response;
}

export async function POST(request: Request) {
  return clearViewerPortalSession(request);
}

export async function GET(request: Request) {
  return clearViewerPortalSession(request);
}
