// Offline rule import only. This script never reads or writes analytics facts.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createHash } from "node:crypto";
import XLSX from "xlsx";

const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error("Usage: node scripts/site-seo/import-medroche-intent-core.mjs SOURCE.xls TARGET.json");
const bytes = readFileSync(source);
const workbook = XLSX.read(bytes, { type: "buffer" });
if (!workbook.Sheets["Разбивка"]) throw new Error("Required sheet Разбивка is absent");
const queries = XLSX.utils.sheet_to_json(workbook.Sheets["Разбивка"])
  .filter(row => String(row["Запрос"] ?? "").trim())
  .map(row => ({ query: String(row["Запрос"]).trim(), group: String(row["Лесическая группа"] ?? "").trim() }));
if (queries.some(row => !row.group)) throw new Error("Every query requires an expert group");
if (new Set(queries.map(row => row.query)).size !== queries.length) throw new Error("Duplicate expert query");
const catalogue = {
  schemaVersion: 1, version: "medroche-medical-intent-v1", sourceFilename: basename(source),
  sourceSha256: createHash("sha256").update(bytes).digest("hex"), sourceSheet: "Разбивка",
  note: "Expert rule seed only. Historical Wordstat frequencies are not analytics facts or current weights.",
  queries,
};
writeFileSync(resolve(target), JSON.stringify(catalogue, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ queries: queries.length, groups: new Set(queries.map(row => row.group)).size, sourceSha256: catalogue.sourceSha256 }));
