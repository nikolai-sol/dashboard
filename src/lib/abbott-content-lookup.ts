import { createHash } from "node:crypto";

/** The importer and reader contract for a workbook title lookup is SHA-256 of its exact title text. */
export function abbottTitleLookupHash(title: string): string {
  return createHash("sha256").update(title).digest("hex");
}
