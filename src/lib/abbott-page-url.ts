export function isAbbottWebPageUrl(rawValue: unknown): boolean {
  const value = String(rawValue ?? "").trim().replaceAll("&amp;", "&");
  if (!value || /^[a-z]:[\\/]/i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return !/^[a-z][a-z0-9+.-]*:/i.test(value);
  }
}

const TRACKING_QUERY_KEYS = new Set([
  "access_code",
  "dclid",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "_ga",
  "_gl",
  "yclid",
  "ysclid",
]);

const IDENTITY_PATH_SAFE = new Set("/:@!$&'()*+,;=-._~");
const RESERVED_PATH_CHARACTERS = new Set(":/?#[]@!$&'()*+,;=%");

function strictPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.codePointAt(0)!.toString(16).toUpperCase()}`,
  );
}

function normalizeAbbottIdentityPath(pathname: string): string {
  let normalized = "";

  for (let index = 0; index < pathname.length;) {
    if (pathname[index] !== "%") {
      const character = String.fromCodePoint(pathname.codePointAt(index)!);
      normalized += IDENTITY_PATH_SAFE.has(character)
        ? character
        : strictPercentEncode(character);
      index += character.length;
      continue;
    }

    let encoded = "";
    while (
      pathname[index] === "%"
      && /^[0-9a-f]{2}$/i.test(pathname.slice(index + 1, index + 3))
    ) {
      encoded += pathname.slice(index, index + 3);
      index += 3;
    }
    if (!encoded) {
      normalized += "%25";
      index += 1;
      continue;
    }

    try {
      for (const character of decodeURIComponent(encoded)) {
        normalized += RESERVED_PATH_CHARACTERS.has(character)
          ? strictPercentEncode(character)
          : IDENTITY_PATH_SAFE.has(character)
            ? character
            : strictPercentEncode(character);
      }
    } catch {
      normalized += encoded.toUpperCase();
    }
  }

  const segments: string[] = [];
  for (const segment of normalized.replace(/\/{2,}/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length ? `/${segments.join("/")}` : "/";
}

/** Canonical lookup identity for Abbott content URLs. */
export function normalizeAbbottContentIdentityUrl(rawValue: unknown): string {
  const value = String(rawValue ?? "").trim().replaceAll("&amp;", "&");
  if (value.startsWith("//") || !isAbbottWebPageUrl(value)) return "";

  try {
    const absoluteAuthority = value.match(/^https?:\/\/([^/?#]*)/i);
    if (
      absoluteAuthority
      && (!absoluteAuthority[1] || absoluteAuthority[1].includes("@") || absoluteAuthority[1].includes("%"))
    ) {
      return "";
    }
    const source = value.startsWith("/")
      ? `https://abbottpro.ru${value}`
      : /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
        ? value
        : `https://abbottpro.ru/${value}`;
    const url = new URL(source);
    if (url.username || url.password) return "";
    if (url.hostname.toLowerCase() === "www.abbottpro.ru") url.hostname = "abbottpro.ru";
    if (url.hostname.toLowerCase() !== "abbottpro.ru") return "";
    if (url.hostname.toLowerCase() === "abbottpro.ru") url.protocol = "https:";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith("utm_") || TRACKING_QUERY_KEYS.has(normalized)) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    url.pathname = normalizeAbbottIdentityPath(url.pathname);
    return url.toString().replace(/\/$/, url.pathname === "/" ? "/" : "");
  } catch {
    return "";
  }
}

export function normalizeAbbottPageUrl(rawValue: unknown): string {
  const value = String(rawValue ?? "").trim().replaceAll("&amp;", "&");
  if (!isAbbottWebPageUrl(value)) return "";
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
  if (!isAbbottWebPageUrl(raw)) return "";
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
