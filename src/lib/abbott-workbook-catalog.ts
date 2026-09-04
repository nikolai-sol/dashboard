import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

interface AbbottWorkbookSheetConfig {
  name: string;
  materialType: string | null;
  directionKey?: string;
  accessKey?: string;
  typeKey?: string;
}

const CONTENT_SHEETS: AbbottWorkbookSheetConfig[] = [
  { name: "pages", materialType: null, directionKey: "Направление", accessKey: "Доступ", typeKey: "Тип материала" },
  { name: "Статьи", materialType: "Статьи", directionKey: "Направление", accessKey: "Доступ" },
  { name: "Видео", materialType: "Видео", directionKey: "Направление", accessKey: "Доступ" },
  { name: "Клинические случаи", materialType: "Клинические случаи", directionKey: "Направление", accessKey: "Доступ" },
  { name: "Научно-образовательные брошюры", materialType: "Научно-образовательные брошюры", directionKey: "Направление", accessKey: "Доступ" },
  { name: "Подкасты", materialType: "Подкасты", directionKey: "Направление" },
  { name: "Калькуляторы", materialType: "Калькуляторы", directionKey: "Направление", accessKey: "Доступ" },
  { name: "Проверить знания", materialType: "Проверить знания", directionKey: "Направление" },
  { name: "Помощник фармацевта", materialType: "Помощник фармацевта" },
  { name: "Алгоритмы фармацевтического кон", materialType: "Алгоритмы", directionKey: "Направление" },
  { name: "Клинические рекомендации", materialType: "Клинические рекомендации", directionKey: "Направления" },
  { name: "Таблицы", materialType: "Таблицы", directionKey: "Направление", accessKey: "Доступ" },
];

export interface AbbottWorkbookCatalogRow {
  sourceSheet: string;
  sourceRowOrdinal: number;
  pageTitle: string;
  materialType: string | null;
  sourceSlug: string | null;
  direction: string | null;
  access: string | null;
  isActive: boolean;
  targetKeyFingerprint: string;
}

export interface AbbottWorkbookCatalogParseResult {
  rows: AbbottWorkbookCatalogRow[];
  manifest: {
    source_kind: "abbott_workbook_catalog";
    content_count: number;
    rejected_count: 0;
  };
}

export interface AbbottCatalogAudit {
  source_row_count: number;
  rows_with_slug: number;
  unique_lookup_keys: number;
  identical_groups: number;
  ambiguous_groups: number;
  excess_occurrences: number;
  conflict_set_fingerprints: string[];
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function fingerprint(fields: readonly unknown[]): string {
  const hash = createHash("sha256");
  for (const field of fields) {
    const value = field === null || field === undefined ? "" : String(field);
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value);
    hash.update(";");
  }
  return hash.digest("hex");
}

export function parseAbbottWorkbookCatalog(buffer: Buffer): AbbottWorkbookCatalogParseResult {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true });
  const rows: AbbottWorkbookCatalogRow[] = [];

  for (const config of CONTENT_SHEETS) {
    const worksheet = workbook.Sheets[config.name];
    if (!worksheet) continue;
    const sourceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: true });
    sourceRows.forEach((row, index) => {
      const sourceRowOrdinal = index + 1;
      const pageTitle = text(row["Название"]);
      const sourceSlug = text(row["Символьный код"]) || null;
      if (!pageTitle && !sourceSlug) {
        const hasRelevantMetadata = [
          row["Тип материала"],
          row["Направление"],
          row["Направления"],
          row["Доступ"],
          row["Активность"],
        ].some((value) => text(value) !== "");
        if (hasRelevantMetadata) throw new Error("Workbook content identity is blank");
        return;
      }
      if (!pageTitle) throw new Error(`Workbook content title is blank in ${config.name}`);
      const materialType = text(config.typeKey ? row[config.typeKey] : config.materialType) || config.materialType;
      const direction = text(config.directionKey ? row[config.directionKey] : "") || null;
      const access = text(config.accessKey ? row[config.accessKey] : "") || null;
      const activeLabel = text(row["Активность"]).toLocaleLowerCase("ru-RU");
      let isActive = true;
      if (["нет", "no", "false", "0"].includes(activeLabel)) isActive = false;
      else if (activeLabel && !["да", "yes", "true", "1"].includes(activeLabel)) {
        throw new Error(`Workbook content active state is invalid in ${config.name}`);
      }
      const targetKeyFingerprint = fingerprint([
        config.name,
        sourceRowOrdinal,
        pageTitle,
        materialType,
        sourceSlug,
        direction,
        access,
        isActive,
      ]);
      rows.push({
        sourceSheet: config.name,
        sourceRowOrdinal,
        pageTitle,
        materialType,
        sourceSlug,
        direction,
        access,
        isActive,
        targetKeyFingerprint,
      });
    });
  }

  if (rows.length === 0) throw new Error("Workbook XLSX has no content catalog rows");
  return {
    rows,
    manifest: { source_kind: "abbott_workbook_catalog", content_count: rows.length, rejected_count: 0 },
  };
}

export function buildAbbottCatalogAudit(rows: readonly AbbottWorkbookCatalogRow[]): AbbottCatalogAudit {
  const lookupGroups = new Map<string, AbbottWorkbookCatalogRow[]>();
  for (const row of rows) {
    const lookupKeys = [fingerprint(["title", row.pageTitle])];
    if (row.sourceSlug) lookupKeys.push(fingerprint(["slug", row.sourceSlug]));
    for (const lookupKey of lookupKeys) {
      const group = lookupGroups.get(lookupKey) ?? [];
      group.push(row);
      lookupGroups.set(lookupKey, group);
    }
  }

  let identicalGroups = 0;
  let ambiguousGroups = 0;
  let excessOccurrences = 0;
  const conflictSetFingerprints: string[] = [];
  for (const [lookupKey, group] of lookupGroups) {
    if (group.length < 2) continue;
    const normalizedRows = new Set(group.map((row) => fingerprint([
      row.pageTitle,
      row.materialType,
      row.sourceSlug,
      row.direction,
      row.access,
      row.isActive,
    ])));
    if (normalizedRows.size === 1) identicalGroups += 1;
    else ambiguousGroups += 1;
    excessOccurrences += group.length - 1;
    conflictSetFingerprints.push(fingerprint([
      "conflict-set",
      lookupKey,
      ...group.map((row) => row.targetKeyFingerprint).sort(),
    ]));
  }

  return {
    source_row_count: rows.length,
    rows_with_slug: rows.filter((row) => row.sourceSlug !== null).length,
    unique_lookup_keys: lookupGroups.size,
    identical_groups: identicalGroups,
    ambiguous_groups: ambiguousGroups,
    excess_occurrences: excessOccurrences,
    conflict_set_fingerprints: conflictSetFingerprints.sort(),
  };
}
