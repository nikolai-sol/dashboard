const ZARUKU_ORIGIN = "https://zaruku.ru";
const ZARUKU_DOMAIN = "zaruku.ru";

function normalizedHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export function isHostnameWithinDomain(hostname: string, domain: string): boolean {
  const normalized = normalizedHostname(hostname);
  const expected = normalizedHostname(domain);
  return Boolean(expected) && (normalized === expected || normalized.endsWith(`.${expected}`));
}

export function parseAbsoluteHttpUrl(value: string | null | undefined): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

export function resolveAbsoluteHttpUrl(value: string | null | undefined): string | null {
  return parseAbsoluteHttpUrl(value)?.toString() ?? null;
}

export function resolveZarukuContentUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, ZARUKU_ORIGIN);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      !isHostnameWithinDomain(url.hostname, ZARUKU_DOMAIN)
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}
