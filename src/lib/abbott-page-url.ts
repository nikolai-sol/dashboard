export function normalizeAbbottPageUrl(rawValue: unknown): string {
  const value = String(rawValue ?? "").trim().replaceAll("&amp;", "&");
  if (!value) return "";
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return value.split(/[?#]/, 1)[0]?.replace(/\/{2,}/g, "/").replace(/\/+$/, "") ?? "";
  }
}
