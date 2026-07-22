const ZARUKU_ORIGIN = "https://zaruku.ru";

export function resolveZarukuContentUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, ZARUKU_ORIGIN);
    if (url.protocol !== "https:" || url.hostname !== "zaruku.ru") return null;
    return url.toString();
  } catch {
    return null;
  }
}
