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
    const pathname = value.split(/[?#]/, 1)[0]?.replace(/\/{2,}/g, "/") ?? "";
    return pathname ? pathname.replace(/\/+$/, "") || "/" : "";
  }
}

/** Canonical lookup identity for Abbott return-page directions. */
export function normalizeAbbottPagePath(value: string): string {
  const raw = value.trim().replaceAll("&amp;", "&");
  if (!raw) return "";
  const isAbsolute = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  let pathname: string;
  if (isAbsolute) {
    try {
      pathname = new URL(raw).pathname;
    } catch {
      pathname = raw.split(/[?#]/, 1)[0] ?? "";
    }
  } else {
    pathname = raw.split(/[?#]/, 1)[0] ?? "";
  }
  pathname = pathname.replace(/\/{2,}/g, "/");
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;
  return pathname.replace(/\/+$/, "") || "/";
}
