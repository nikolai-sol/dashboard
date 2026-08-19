import { createHash } from "node:crypto";

/** Match the canonical classifier's NFKC and collapsed-whitespace title key. */
export function abbottTitleLookupHash(title: string): string {
  const normalized = title.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}
