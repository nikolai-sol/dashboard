import fs from "node:fs";
import path from "node:path";
import type { RowDataPacket } from "mysql2";
import * as XLSX from "xlsx";
import pool from "@/lib/db";
import type {
  AbbottBiData,
  AbbottBiBitrixPageRow,
  AbbottBiBitrixSummary,
  AbbottBiExternalClickRow,
  AbbottBiExternalEventRow,
  AbbottBiMaterialRow,
  AbbottBiPageStatRow,
  AbbottBiReturningRow,
  AbbottBiSessionJourneyRow,
  AbbottBiSessionJourneysData,
  AbbottBiTimeBucketRow,
  AbbottBiTimeBuckets,
  AbbottBiUserActionRow,
  AbbottBiUserSummaryRow,
} from "@/lib/types";

type WorkbookCache = {
  versionKey: string;
  data: ParsedAbbottWorkbook;
};

type ParsedAbbottWorkbook = {
  userDirections: Map<string, string | null>;
  generalMaterials: Array<{ name: string; url: string }>;
  externalEvents: AbbottBiExternalEventRow[];
  contentByTitle: Map<
    string,
    {
      direction: string | null;
      material_type: string | null;
      access: string | null;
      is_active: boolean | null;
    }
  >;
  contentByTitleAndType: Map<
    string,
    {
      direction: string | null;
      material_type: string | null;
      access: string | null;
      is_active: boolean | null;
    }
  >;
  contentBySlug: Map<
    string,
    {
      direction: string | null;
      material_type: string | null;
      access: string | null;
      is_active: boolean | null;
    }
  >;
  urlReturnDirections: Map<string, string | null>;
  ymUrlReturn: Array<{
    url: string;
    date: string | null;
    visits: number;
    returning_1_day: number;
    returning_2_7_days: number;
    returning_8_31_days: number;
  }>;
};

type PortalBiConfig = {
  defaultCounterIds: string[];
  useWorkbook: boolean;
  useAbbottMetadata: boolean;
  useBitrix: boolean;
  useExternalClicks: boolean;
  useAbbottReturningApi: boolean;
};

type ParsedBitrixAnalytics = {
  summary: AbbottBiBitrixSummary | null;
  rows: AbbottBiBitrixPageRow[];
};

type RawBitrixAnalyticsPayload = {
  summary?: {
    raw_hit_rows?: number;
    clean_hit_rows?: number;
    raw_date_from?: string;
    raw_date_to?: string;
    date_from?: string;
    date_to?: string;
    sessions_loaded?: number;
    unique_clean_urls?: number;
    excluded?: Record<string, number>;
  };
  rows?: Array<{
    url?: string;
    normalized_url?: string;
    path?: string;
    material_type_hint?: string;
    pageviews?: number;
    sessions?: number;
    users?: number;
    guests?: number;
    logged_in_hits?: number;
    anonymous_hits?: number;
    logged_in_sessions?: number;
    anonymous_sessions?: number;
    entry_sessions?: number;
    exit_sessions?: number;
    avg_session_duration_seconds?: number;
    top_utm_source?: string;
    top_utm_medium?: string;
    top_utm_campaign?: string;
  }>;
};

type ContentSheetConfig = {
  name: string;
  materialType: string | null;
  directionKey?: string;
  accessKey?: string;
  typeKey?: string;
};

type LegacyUserSummaryRow = RowDataPacket & {
  user_id: number | string | null;
  has_user_id: number | string | null;
  traffic_source: string | null;
  visits: number | string | null;
  users: number | string | null;
  new_users: number | string | null;
  page_depth: number | string | null;
  avg_duration: number | string | null;
  bounce_rate: number | string | null;
};

type LegacyUserActionRow = RowDataPacket & {
  user_id: number | string | null;
  has_user_id: number | string | null;
  traffic_source: string | null;
  start_url: string | null;
  end_url: string | null;
  visits: number | string | null;
  page_depth: number | string | null;
  avg_duration: number | string | null;
};

type CanonicalUserBehaviorRow = RowDataPacket & {
  user_id: number | string | null;
  has_user_id?: number | string | null;
  traffic_source: string | null;
  start_url?: string | null;
  end_url?: string | null;
  visits: number | string | null;
  users?: number | string | null;
  new_users?: number | string | null;
  page_depth: number | string | null;
  avg_duration: number | string | null;
  bounce_rate?: number | string | null;
};

type LegacyPageStatRow = RowDataPacket & {
  page_title: string | null;
  url: string | null;
  pageviews: number | string | null;
  users: number | string | null;
};

type CanonicalPageStatRow = RowDataPacket & {
  page_title: string | null;
  url: string | null;
  pageviews: number | string | null;
  users: number | string | null;
};

type CanonicalTrafficSummaryRow = RowDataPacket & {
  traffic_source: string | null;
  visits: number | string | null;
  users: number | string | null;
  new_users: number | string | null;
  page_depth: number | string | null;
  avg_duration: number | string | null;
  bounce_rate: number | string | null;
};

type LegacyReturningFallbackRow = RowDataPacket & {
  url: string | null;
  visits: number | string | null;
};

type AbbottReturningApiRow = {
  report_date: string;
  url: string;
  visits: number;
  returning_1_day: number;
  returning_2_7_days: number;
  returning_8_31_days: number;
};

type LegacyExternalFactDailyRow = RowDataPacket & {
  report_date: string | Date | null;
  external_url: string | null;
  outbound_clicks: number | string | null;
};

type LegacyTimeBucketCountRow = RowDataPacket & {
  bucket_id: string | null;
  users: number | string | null;
};

type LegacyTimeBucketPageRow = RowDataPacket & {
  url: string | null;
  bucket_id: string | null;
  users: number | string | null;
};

declare global {
  var __abbottWorkbookCache: WorkbookCache | undefined;
}

const EMPTY_WORKBOOK_DATA: ParsedAbbottWorkbook = {
  userDirections: new Map(),
  generalMaterials: [],
  externalEvents: [],
  contentByTitle: new Map(),
  contentByTitleAndType: new Map(),
  contentBySlug: new Map(),
  urlReturnDirections: new Map(),
  ymUrlReturn: [],
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asString(value: unknown): string {
  return String(value ?? "").trim();
}

function asDateString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return asString(value).slice(0, 10);
}

function workbookJsonCandidates() {
  return [path.join(process.cwd(), "public", "abbott", "abbott-workbook.json")];
}

function workbookXlsxCandidates() {
  return [path.join(process.cwd(), "public", "abbott", "Abbott names.xlsx")];
}

function bitrixAnalyticsCandidates() {
  return [path.join(process.cwd(), "public", "abbott", "bitrix-analytics.json")];
}

function bitrixSessionJourneysCandidates() {
  return [path.join(process.cwd(), "public", "abbott", "bitrix-session-journeys.json")];
}

function resolveWorkbookJsonPath() {
  const match = workbookJsonCandidates().find((candidate) => fs.existsSync(candidate));
  if (!match) {
    throw new Error("Abbott workbook JSON not found");
  }
  return match;
}

function resolveWorkbookXlsxPath() {
  return workbookXlsxCandidates().find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveBitrixAnalyticsPath() {
  return bitrixAnalyticsCandidates().find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveBitrixSessionJourneysPath() {
  return bitrixSessionJourneysCandidates().find((candidate) => fs.existsSync(candidate)) ?? null;
}

function loadPortalWorkbookData(useWorkbook: boolean): ParsedAbbottWorkbook {
  return useWorkbook ? loadWorkbookData() : EMPTY_WORKBOOK_DATA;
}

function emptySessionJourneysData(): AbbottBiSessionJourneysData {
  return { report_date: "", schema: null, summary: null, rows: [] };
}

function loadBitrixSessionJourneysData(): AbbottBiSessionJourneysData {
  const journeysPath = resolveBitrixSessionJourneysPath();
  if (!journeysPath) {
    return emptySessionJourneysData();
  }

  const payload = JSON.parse(fs.readFileSync(journeysPath, "utf-8")) as {
    report_date?: string;
    schema?: AbbottBiSessionJourneysData["schema"];
    summary?: AbbottBiSessionJourneysData["summary"];
    rows?: Array<{
      session_id?: number;
      user_id?: number | null;
      has_user_id?: boolean;
      entry_url_day?: string;
      exit_url_day?: string;
      entry_url_session?: string;
      exit_url_session?: string;
      hits_total?: number;
      hits_clean?: number;
      hits_content?: number;
      steps_content?: number;
      events_count?: number;
      duration_seconds?: number;
      content_path?: string[];
      content_path_summary?: string;
      all_path_summary?: string;
      events_available?: boolean;
    }>;
  };

  const rows = (payload.rows ?? [])
    .map<AbbottBiSessionJourneyRow>((row) => {
      const hasUserId = Boolean(row.has_user_id) && asNumber(row.user_id) > 0;
      return {
        session_id: Math.round(asNumber(row.session_id)),
        user_id: hasUserId ? String(Math.trunc(asNumber(row.user_id))) : null,
        has_user_id: hasUserId,
        entry_url_day: asString(row.entry_url_day),
        exit_url_day: asString(row.exit_url_day),
        entry_url_session: asString(row.entry_url_session),
        exit_url_session: asString(row.exit_url_session),
        hits_total: Math.round(asNumber(row.hits_total)),
        hits_clean: Math.round(asNumber(row.hits_clean)),
        hits_content: Math.round(asNumber(row.hits_content)),
        steps_content: Math.round(asNumber(row.steps_content)),
        events_count: Math.round(asNumber(row.events_count)),
        duration_seconds: Math.round(asNumber(row.duration_seconds)),
        content_path: (row.content_path ?? []).map((url) => asString(url)).filter(Boolean),
        content_path_summary: asString(row.content_path_summary),
        all_path_summary: asString(row.all_path_summary),
        events_available: Boolean(row.events_available),
      };
    })
    .filter((row) => row.session_id > 0);

  return {
    report_date: asString(payload.report_date),
    schema: payload.schema ?? null,
    summary: payload.summary ?? null,
    rows,
  };
}

function getContentValue(row: Record<string, unknown>, key: string) {
  return asString(row[key]);
}

function upsertContentMetadata(
  map: ParsedAbbottWorkbook["contentByTitle"] | ParsedAbbottWorkbook["contentBySlug"],
  title: string,
  next: { direction?: string | null; material_type?: string | null; access?: string | null },
  isActive?: boolean | null,
) {
  if (!title) return;
  const current = map.get(title) ?? {
    direction: null,
    material_type: null,
    access: null,
    is_active: null,
  };
  const prefersIncoming =
    current.is_active !== true && isActive === true
      ? true
      : current.is_active === null && isActive === false
        ? true
        : false;
  map.set(title, {
    direction: prefersIncoming ? next.direction ?? null : current.direction ?? next.direction ?? null,
    material_type: prefersIncoming ? next.material_type ?? null : current.material_type ?? next.material_type ?? null,
    access: prefersIncoming ? next.access ?? null : current.access ?? next.access ?? null,
    is_active:
      current.is_active === true
        ? true
        : isActive === true
          ? true
          : isActive === false
            ? false
            : current.is_active ?? null,
  });
}

function normalizeAbbottActivity(value: unknown): boolean | null {
  const normalized = asString(value).toLowerCase();
  if (!normalized) return null;
  if (normalized === "да") return true;
  if (normalized === "нет") return false;
  return null;
}

function extractAbbottSlugFromUrl(rawUrl: string | null | undefined) {
  const value = asString(rawUrl);
  if (!value) return null;
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.length === 0) return null;
    const lastSegment = segments[segments.length - 1] ?? "";
    if (!lastSegment || /^\d+$/.test(lastSegment)) return null;
    return lastSegment;
  } catch {
    return null;
  }
}

function normalizeAbbottPageUrl(rawUrl: string | null | undefined) {
  const value = asString(rawUrl).replaceAll("&amp;", "&");
  if (!value) return "";
  try {
    const url = new URL(value);
    const protocol = url.protocol.toLowerCase();
    const host = url.host.toLowerCase();
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${protocol}//${host}${pathname}`;
  } catch {
    return value.split("#")[0]?.split("?")[0]?.replace(/\/+$/, "") || value;
  }
}

function emptyBitrixMetrics() {
  return {
    bitrix_pageviews: 0,
    bitrix_sessions: 0,
    bitrix_users: 0,
    bitrix_logged_in_sessions: 0,
    bitrix_anonymous_sessions: 0,
    bitrix_avg_session_duration: 0,
  };
}

const ABBOTT_DIRECTION_BY_PREFIX: Record<string, string> = {
  cardio: "Кардиология [262338]",
  gastro: "Гастроэнтерология [262340]",
  nevro: "Неврология и психиатрия [262339]",
  wh: "Женское здоровье [262337]",
  pulmo: "Здоровье дыхательной системы [263746]",
  "respiratory-assistant": "Здоровье дыхательной системы [263746]",
  farmatsevtam: "Фармацевты",
  dermatology: "Дерматология",
};

const ABBOTT_DIRECTION_BY_QUERY_ID: Record<string, string> = {
  "262337": "Женское здоровье [262337]",
  "262338": "Кардиология [262338]",
  "262339": "Неврология и психиатрия [262339]",
  "262340": "Гастроэнтерология [262340]",
  "263746": "Здоровье дыхательной системы [263746]",
  "620888": "Управление сахарным диабетом [620888]",
};

const ABBOTT_MATERIAL_TYPE_BY_PREFIX: Record<string, string> = {
  articles: "Статьи",
  video: "Видео",
  "klinicheskie-sluchai": "Клинические случаи",
  "nauchno-obrazovatelnye-broshyury": "Научно-образовательные брошюры",
  podcasts: "Подкасты",
  tables: "Таблицы",
  calculators: "Калькуляторы",
};

const ABBOTT_UTILITY_PAGE_PATHS = new Set(["/auth", "/auth_without_phone"]);

function isAbbottUtilityPageUrl(rawUrl: string | null | undefined) {
  const normalized = normalizeAbbottPageUrl(rawUrl);
  if (!normalized) return false;
  try {
    const pathname = new URL(normalized).pathname.replace(/\/+$/, "") || "/";
    return ABBOTT_UTILITY_PAGE_PATHS.has(pathname);
  } catch {
    return false;
  }
}

export function toAbbottDateOnly(value: string | null | undefined) {
  return asString(value).slice(0, 10);
}

export function isAbbottBitrixPeriodActive(
  dashboardFrom: string,
  dashboardTo: string,
  summary: AbbottBiBitrixSummary | null,
) {
  if (!summary?.date_from || !summary?.date_to) return false;
  const bitrixFrom = toAbbottDateOnly(summary.date_from);
  const bitrixTo = toAbbottDateOnly(summary.date_to);
  const from = toAbbottDateOnly(dashboardFrom);
  const to = toAbbottDateOnly(dashboardTo);
  if (!from || !to || !bitrixFrom || !bitrixTo) return false;
  return from >= bitrixFrom && to <= bitrixTo;
}

function resolveAbbottPageMetadata(
  rawUrl: string,
  pageTitle: string,
  contentByTitle: ParsedAbbottWorkbook["contentByTitle"],
  contentByTitleAndType: ParsedAbbottWorkbook["contentByTitleAndType"],
  contentBySlug: ParsedAbbottWorkbook["contentBySlug"],
  userDirections: Map<string, string | null>,
) {
  const url = normalizeAbbottPageUrl(rawUrl);
  if (isAbbottUtilityPageUrl(url)) {
    return {
      direction: null,
      material_type: null,
      access: null,
    };
  }
  const inferredMaterialType = inferAbbottMaterialTypeFromUrl(url);
  const contentMeta =
    (inferredMaterialType ? contentByTitleAndType.get(`${inferredMaterialType}::${pageTitle}`) : null) ??
    contentByTitle.get(pageTitle) ??
    contentBySlug.get(extractAbbottSlugFromUrl(url) ?? "");
  return {
    direction: contentMeta?.direction ?? inferAbbottDirectionFromUrl(rawUrl, userDirections) ?? null,
    material_type: contentMeta?.material_type ?? inferredMaterialType ?? null,
    access: contentMeta?.access ?? null,
  };
}

function inferAbbottDirectionFromUrl(
  rawUrl: string | null | undefined,
  directionById?: Map<string, string | null>,
) {
  const value = asString(rawUrl);
  if (!value) return null;
  try {
    const url = new URL(value);
    const searchParams = url.searchParams;

    for (const key of ["direction", "direction[]"]) {
      const matchedDirectionId = searchParams.getAll(key).find((candidate) => ABBOTT_DIRECTION_BY_QUERY_ID[candidate]);
      if (matchedDirectionId) {
        return ABBOTT_DIRECTION_BY_QUERY_ID[matchedDirectionId];
      }
    }

    if (directionById) {
      for (const key of ["preparat", "id", "ID", "material", "content_id"]) {
        const matchedContentId = searchParams.getAll(key).find((candidate) => {
          const direction = directionById.get(candidate);
          return typeof direction === "string" && direction.trim().length > 0;
        });
        if (matchedContentId) {
          return directionById.get(matchedContentId) ?? null;
        }
      }
    }

    const [prefix] = url.pathname.split("/").filter(Boolean);
    if (!prefix) return null;
    if (ABBOTT_DIRECTION_BY_PREFIX[prefix]) {
      return ABBOTT_DIRECTION_BY_PREFIX[prefix];
    }

    if (directionById) {
      const matchedPathId = url.pathname
        .split("/")
        .filter(Boolean)
        .find((segment) => {
          if (!/^\d+$/.test(segment)) return false;
          const direction = directionById.get(segment);
          return typeof direction === "string" && direction.trim().length > 0;
        });
      if (matchedPathId) {
        return directionById.get(matchedPathId) ?? null;
      }
    }

    return null;
  } catch {
    return null;
  }
}

function inferAbbottMaterialTypeFromUrl(rawUrl: string | null | undefined) {
  const value = asString(rawUrl);
  if (!value) return null;
  try {
    const url = new URL(value);
    const [prefix] = url.pathname.split("/").filter(Boolean);
    if (!prefix) return null;
    return ABBOTT_MATERIAL_TYPE_BY_PREFIX[prefix] ?? null;
  } catch {
    return null;
  }
}

function loadWorkbookData(): ParsedAbbottWorkbook {
  const jsonPath = resolveWorkbookJsonPath();
  const jsonMtime = fs.statSync(jsonPath).mtimeMs;
  const xlsxPath = resolveWorkbookXlsxPath();
  const xlsxMtime = xlsxPath ? fs.statSync(xlsxPath).mtimeMs : 0;
  const versionKey = `${jsonMtime}:${xlsxMtime}`;
  if (global.__abbottWorkbookCache?.versionKey === versionKey) {
    return global.__abbottWorkbookCache.data;
  }

  const payload = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as {
    id?: Array<{ id?: number; direction?: string | null }>;
    general_materials?: Array<{ name?: string; url?: string }>;
    events?: Array<{ title?: string; direction?: string | null; registration_url?: string; access?: string | null }>;
    ym_url_return?: Array<{
      url?: string;
      date?: string | null;
      visits?: number;
      returning_1_day?: number;
      returning_2_7_days?: number;
      returning_8_31_days?: number;
    }>;
  };

  const userDirections = new Map<string, string | null>();
  (payload.id ?? []).forEach((row) => {
    const numericId = asNumber(row.id);
    if (!Number.isFinite(numericId) || numericId <= 0) return;
    userDirections.set(String(Math.trunc(numericId)), asString(row.direction) || null);
  });

  const generalMaterials = (payload.general_materials ?? [])
    .map((row) => ({
      name: asString(row.name),
      url: asString(row.url),
    }))
    .filter((row) => row.name && row.url);

  const externalEvents = (payload.events ?? [])
    .map<AbbottBiExternalEventRow>((row) => ({
      title: asString(row.title),
      direction: asString(row.direction) || null,
      registration_url: asString(row.registration_url),
      access: asString(row.access) || null,
    }))
    .filter((row) => row.title && row.registration_url);

  const ymUrlReturn = (payload.ym_url_return ?? [])
    .map((row) => ({
      url: asString(row.url),
      date: asString(row.date) || null,
      visits: asNumber(row.visits),
      returning_1_day: asNumber(row.returning_1_day),
      returning_2_7_days: asNumber(row.returning_2_7_days),
      returning_8_31_days: asNumber(row.returning_8_31_days),
    }))
    .filter((row) => row.url);

  const contentByTitle = new Map<
    string,
    {
      direction: string | null;
      material_type: string | null;
      access: string | null;
      is_active: boolean | null;
    }
  >();
  const contentByTitleAndType = new Map<
    string,
    {
      direction: string | null;
      material_type: string | null;
      access: string | null;
      is_active: boolean | null;
    }
  >();
  const contentBySlug = new Map<
    string,
    {
      direction: string | null;
      material_type: string | null;
      access: string | null;
      is_active: boolean | null;
    }
  >();
  const urlReturnDirections = new Map<string, string | null>();

  if (xlsxPath) {
    const workbookBuffer = fs.readFileSync(xlsxPath);
    const workbook = XLSX.read(workbookBuffer, { type: "buffer" });
    const contentSheets: ContentSheetConfig[] = [
      { name: "pages", materialType: null, directionKey: "Направление", accessKey: "Доступ", typeKey: "Тип материала" },
      { name: "Статьи", materialType: "Статьи", directionKey: "Направление", accessKey: "Доступ" },
      { name: "Видео", materialType: "Видео", directionKey: "Направление", accessKey: "Доступ" },
      { name: "Клинические случаи", materialType: "Клинические случаи", directionKey: "Направление", accessKey: "Доступ" },
      {
        name: "Научно-образовательные брошюры",
        materialType: "Научно-образовательные брошюры",
        directionKey: "Направление",
        accessKey: "Доступ",
      },
      { name: "Подкасты", materialType: "Подкасты", directionKey: "Направление" },
      { name: "Калькуляторы", materialType: "Калькуляторы", directionKey: "Направление", accessKey: "Доступ" },
      { name: "Проверить знания", materialType: "Проверить знания", directionKey: "Направление" },
      { name: "Помощник фармацевта", materialType: "Помощник фармацевта" },
      { name: "Алгоритмы фармацевтического кон", materialType: "Алгоритмы", directionKey: "Направление" },
      { name: "Клинические рекомендации", materialType: "Клинические рекомендации", directionKey: "Направления" },
      { name: "Таблицы", materialType: "Таблицы", directionKey: "Направление", accessKey: "Доступ" },
    ];

    contentSheets.forEach((sheet) => {
      const worksheet = workbook.Sheets[sheet.name];
      if (!worksheet) return;
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
      rows.forEach((row) => {
        const title = getContentValue(row, "Название");
        const slug = getContentValue(row, "Символьный код");
        const direction = sheet.directionKey ? getContentValue(row, sheet.directionKey) || null : null;
        const access = sheet.accessKey ? getContentValue(row, sheet.accessKey) || null : null;
        const isActive = normalizeAbbottActivity(row["Активность"]);
        const materialType = sheet.typeKey
          ? getContentValue(row, sheet.typeKey) || sheet.materialType || null
          : sheet.materialType || null;
        upsertContentMetadata(contentByTitle, title, {
          direction,
          access,
          material_type: materialType,
        }, isActive);
        if (title && materialType) {
          upsertContentMetadata(contentByTitleAndType, `${materialType}::${title}`, {
            direction,
            access,
            material_type: materialType,
          }, isActive);
        }
        if (slug) {
          upsertContentMetadata(contentBySlug, slug, {
            direction,
            access,
            material_type: materialType,
          }, isActive);
        }
      });
    });

    const urlReturnSheet = workbook.Sheets.url_return;
    if (urlReturnSheet) {
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(urlReturnSheet, { defval: "" });
      rows.forEach((row) => {
        const url = getContentValue(row, "url");
        const direction = getContentValue(row, "Направление") || null;
        if (!url) return;
        urlReturnDirections.set(url, direction);
      });
    }
  }

  const data = {
    userDirections,
    generalMaterials,
    externalEvents,
    contentByTitle,
    contentByTitleAndType,
    contentBySlug,
    urlReturnDirections,
    ymUrlReturn,
  };
  global.__abbottWorkbookCache = { versionKey, data };
  return data;
}

function loadBitrixAnalyticsData(): ParsedBitrixAnalytics {
  const bitrixPath = resolveBitrixAnalyticsPath();
  if (!bitrixPath) {
    return { summary: null, rows: [] };
  }

  const payload = JSON.parse(fs.readFileSync(bitrixPath, "utf-8")) as RawBitrixAnalyticsPayload;
  const { contentByTitle, contentByTitleAndType, contentBySlug, userDirections } = loadWorkbookData();
  const summary: AbbottBiBitrixSummary | null = payload.summary
    ? {
        raw_hit_rows: Math.round(asNumber(payload.summary.raw_hit_rows)),
        clean_hit_rows: Math.round(asNumber(payload.summary.clean_hit_rows)),
        raw_date_from: asString(payload.summary.raw_date_from),
        raw_date_to: asString(payload.summary.raw_date_to),
        date_from: asString(payload.summary.date_from),
        date_to: asString(payload.summary.date_to),
        sessions_loaded: Math.round(asNumber(payload.summary.sessions_loaded)),
        unique_clean_urls: Math.round(asNumber(payload.summary.unique_clean_urls)),
        excluded: Object.fromEntries(
          Object.entries(payload.summary.excluded ?? {}).map(([key, value]) => [key, Math.round(asNumber(value))]),
        ),
      }
    : null;

  const rows = (payload.rows ?? [])
    .map<AbbottBiBitrixPageRow>((row) => {
      const url = normalizeAbbottPageUrl(row.normalized_url || row.url || "");
      const pageMetadata = resolveAbbottPageMetadata(
        url,
        asString(row.path),
        contentByTitle,
        contentByTitleAndType,
        contentBySlug,
        userDirections,
      );
      const inferredMaterialType = inferAbbottMaterialTypeFromUrl(url) || asString(row.material_type_hint) || null;
      return {
        url,
        path: asString(row.path),
        direction: pageMetadata.direction,
        material_type: pageMetadata.material_type ?? inferredMaterialType,
        access: pageMetadata.access,
        pageviews: Math.round(asNumber(row.pageviews)),
        sessions: Math.round(asNumber(row.sessions)),
        users: Math.round(asNumber(row.users)),
        guests: Math.round(asNumber(row.guests)),
        logged_in_hits: Math.round(asNumber(row.logged_in_hits)),
        anonymous_hits: Math.round(asNumber(row.anonymous_hits)),
        logged_in_sessions: Math.round(asNumber(row.logged_in_sessions)),
        anonymous_sessions: Math.round(asNumber(row.anonymous_sessions)),
        entry_sessions: Math.round(asNumber(row.entry_sessions)),
        exit_sessions: Math.round(asNumber(row.exit_sessions)),
        avg_session_duration: Number(asNumber(row.avg_session_duration_seconds).toFixed(2)),
        top_utm_source: asString(row.top_utm_source),
        top_utm_medium: asString(row.top_utm_medium),
        top_utm_campaign: asString(row.top_utm_campaign),
      };
    })
    .filter((row) => row.url)
    .sort((a, b) => {
      if (b.pageviews !== a.pageviews) return b.pageviews - a.pageviews;
      if (b.sessions !== a.sessions) return b.sessions - a.sessions;
      return a.url.localeCompare(b.url);
    });

  return { summary, rows };
}

function enrichPageStatsWithBitrix(
  pageStats: AbbottBiPageStatRow[],
  bitrixRows: AbbottBiBitrixPageRow[],
): AbbottBiPageStatRow[] {
  const bitrixByUrl = new Map(bitrixRows.map((row) => [normalizeAbbottPageUrl(row.url), row]));
  return pageStats.map((row) => {
    const bitrix = bitrixByUrl.get(normalizeAbbottPageUrl(row.url));
    if (!bitrix) {
      return {
        ...row,
        ...emptyBitrixMetrics(),
      };
    }
    return {
      ...row,
      bitrix_pageviews: bitrix.pageviews,
      bitrix_sessions: bitrix.sessions,
      bitrix_users: bitrix.users,
      bitrix_logged_in_sessions: bitrix.logged_in_sessions,
      bitrix_anonymous_sessions: bitrix.anonymous_sessions,
      bitrix_avg_session_duration: bitrix.avg_session_duration,
    };
  });
}

function buildInClause(values: readonly string[]) {
  return values.map(() => "?").join(", ");
}

const TIME_BUCKETS: AbbottBiTimeBucketRow[] = [
  { bucket_id: "lt_1m", label: "Менее 1 мин", users: 0 },
  { bucket_id: "1_2m", label: "1 - 2 минуты", users: 0 },
  { bucket_id: "2_5m", label: "2 - 5 минут", users: 0 },
  { bucket_id: "gt_5m", label: "Более 5 минут", users: 0 },
];

const ABBOTT_TRAFFIC_SOURCE_FALLBACKS: Record<string, string> = {
  "-1": "Internal traffic",
  "0": "Direct traffic",
  "1": "Link traffic",
  "2": "Search engine traffic",
  "3": "Ad traffic",
  "4": "Cached page traffic",
  "7": "Mailing traffic",
  "8": "Social network traffic",
  "10": "Messenger traffic",
  "11": "Clicks by QR code",
};

const ABBOTT_METRIKA_RETURNING_DIMENSION = "ym:s:endURL";
const ABBOTT_METRIKA_RETURNING_METRICS = [
  "ym:s:visits",
  "ym:s:upToDayUserRecencyPercentage",
  "ym:s:upToWeekUserRecencyPercentage",
  "ym:s:upToMonthUserRecencyPercentage",
].join(",");
const ABBOTT_RETURNING_PAGE_LIMIT = 10000;

function buildTrafficSourceSql(column: string) {
  const cases = Object.entries(ABBOTT_TRAFFIC_SOURCE_FALLBACKS)
    .map(([id, label]) => `WHEN ${column} = ${Number(id)} THEN '${label.replace(/'/g, "''")}'`)
    .join("\n          ");
  return `COALESCE(MAX(traffic.traffic_name), CASE
          ${cases}
          ELSE CONCAT('traffic_id:', CAST(${column} AS CHAR))
        END)`;
}

function buildTimeBucketCase(durationExpr: string) {
  return `
    CASE
      WHEN ${durationExpr} < 60 THEN 'lt_1m'
      WHEN ${durationExpr} < 120 THEN '1_2m'
      WHEN ${durationExpr} < 300 THEN '2_5m'
      ELSE 'gt_5m'
    END
  `;
}

function getMetrikaToken() {
  return asString(process.env.METRIKA_TOKEN || process.env.YANDEX_METRIKA_TOKEN || process.env.METRIKA_OAUTH_TOKEN);
}

function parseDate(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function listDatesInclusive(from: string, to: string) {
  const dates: string[] = [];
  const current = parseDate(from);
  const end = parseDate(to);
  while (current <= end) {
    dates.push(formatDate(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

async function fetchAbbottReturningDay(counterId: string, day: string): Promise<AbbottReturningApiRow[]> {
  const token = getMetrikaToken();
  if (!token) {
    throw new Error("Metrika token is not configured");
  }

  const rows: AbbottReturningApiRow[] = [];
  let offset = 1;

  for (;;) {
    const params = new URLSearchParams({
      ids: counterId,
      date1: day,
      date2: day,
      accuracy: "full",
      lang: "en",
      limit: String(ABBOTT_RETURNING_PAGE_LIMIT),
      offset: String(offset),
      dimensions: ABBOTT_METRIKA_RETURNING_DIMENSION,
      metrics: ABBOTT_METRIKA_RETURNING_METRICS,
    });
    const response = await fetch(`https://api-metrika.yandex.net/stat/v1/data?${params.toString()}`, {
      headers: {
        Authorization: `OAuth ${token}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const details = await response.text();
      throw new Error(`Metrika returned ${response.status} for ${day}: ${details}`);
    }

    const payload = (await response.json()) as {
      data?: Array<{
        dimensions?: Array<{ name?: string | null }>;
        metrics?: Array<number | null>;
      }>;
      total_rows?: number;
      sampled?: boolean;
    };

    for (const row of payload.data ?? []) {
      const url = asString(row.dimensions?.[0]?.name);
      const visits = asNumber(row.metrics?.[0]);
      if (!url || visits <= 0) continue;
      const returning1 = Math.round(visits * (asNumber(row.metrics?.[1]) / 100));
      const returning27 = Math.round(visits * (asNumber(row.metrics?.[2]) / 100));
      const returning831 = Math.round(visits * (asNumber(row.metrics?.[3]) / 100));
      rows.push({
        report_date: day,
        url,
        visits: Math.round(visits),
        returning_1_day: returning1,
        returning_2_7_days: returning27,
        returning_8_31_days: returning831,
      });
    }

    const totalRows = asNumber(payload.total_rows);
    offset += ABBOTT_RETURNING_PAGE_LIMIT;
    if ((payload.data?.length ?? 0) < ABBOTT_RETURNING_PAGE_LIMIT || totalRows < offset) {
      break;
    }
  }

  return rows;
}

async function queryAbbottReturningApi(counterIds: string[], from: string, to: string) {
  const abbottCounterId = counterIds.includes("90602537") ? "90602537" : null;
  if (!abbottCounterId) {
    return [];
  }

  const dailyRows: AbbottReturningApiRow[] = [];
  for (const day of listDatesInclusive(from, to)) {
    const dayRows = await fetchAbbottReturningDay(abbottCounterId, day);
    dailyRows.push(...dayRows);
  }
  const totals = new Map<string, AbbottBiReturningRow>();
  const { urlReturnDirections, userDirections } = loadWorkbookData();

  dailyRows.forEach((row) => {
    const current = totals.get(row.url) ?? {
      url: row.url,
      direction: urlReturnDirections.get(row.url) ?? inferAbbottDirectionFromUrl(row.url, userDirections) ?? null,
      visits: 0,
      returning_1_day: 0,
      returning_2_7_days: 0,
      returning_8_31_days: 0,
    };
    current.visits += row.visits;
    current.returning_1_day += row.returning_1_day;
    current.returning_2_7_days += row.returning_2_7_days;
    current.returning_8_31_days += row.returning_8_31_days;
    totals.set(row.url, current);
  });

  return Array.from(totals.values()).sort((a, b) => {
    if (b.visits !== a.visits) return b.visits - a.visits;
    return a.url.localeCompare(b.url);
  });
}

function normalizeTimeBuckets(rows: LegacyTimeBucketCountRow[]): AbbottBiTimeBucketRow[] {
  const byId = new Map(rows.map((row) => [asString(row.bucket_id), Math.round(asNumber(row.users))]));
  return TIME_BUCKETS.map((bucket) => ({
    ...bucket,
    users: byId.get(bucket.bucket_id) ?? 0,
  }));
}

async function hasCanonicalUserBehaviorRows(counterIds: string[], from: string, to: string) {
  const sql = `
    SELECT COUNT(*) AS row_count
    FROM canonical_fact_user_behavior_daily
    WHERE source_key = 'yandex_metrika'
      AND analytics_account_id IN (${buildInClause(counterIds)})
      AND report_date >= ?
      AND report_date <= ?
  `;
  try {
    const [rows] = await pool.execute<Array<RowDataPacket & { row_count: number | string }>>(sql, [
      ...counterIds,
      from,
      to,
    ]);
    return asNumber(rows[0]?.row_count) > 0;
  } catch (error) {
    console.warn("Abbott canonical user behavior table is not available, falling back to legacy", error);
    return false;
  }
}

async function hasCanonicalTrafficSourceRows(counterIds: string[], from: string, to: string) {
  const sql = `
    SELECT COUNT(*) AS row_count
    FROM canonical_fact_site_analytics_daily
    WHERE source_key = 'yandex_metrika'
      AND analytics_account_id IN (${buildInClause(counterIds)})
      AND analytics_scope = 'other'
      AND report_date >= ?
      AND report_date <= ?
      AND (COALESCE(visits, 0) > 0 OR COALESCE(users, 0) > 0)
  `;
  try {
    const [rows] = await pool.execute<Array<RowDataPacket & { row_count: number | string }>>(sql, [
      ...counterIds,
      from,
      to,
    ]);
    return asNumber(rows[0]?.row_count) > 0;
  } catch (error) {
    console.warn("Abbott canonical traffic-source rows are not available, falling back to UTM traffic", error);
    return false;
  }
}

async function queryCanonicalUserSummary(
  counterIds: string[],
  from: string,
  to: string,
  workbookData: ParsedAbbottWorkbook,
): Promise<AbbottBiUserSummaryRow[]> {
  const hasUserIdExpr = "(user_id REGEXP '^[0-9]+$' AND CAST(user_id AS UNSIGNED) > 0)";
  const userIdExpr = `CASE WHEN ${hasUserIdExpr} THEN CAST(user_id AS UNSIGNED) ELSE NULL END`;
  const sql = `
    SELECT
      ${userIdExpr} AS user_id,
      CASE WHEN ${hasUserIdExpr} THEN 1 ELSE 0 END AS has_user_id,
      MAX(COALESCE(traffic_source, CONCAT('traffic_id:', COALESCE(traffic_source_id, 'unknown')))) AS traffic_source,
      COALESCE(SUM(visits), 0) AS visits,
      COALESCE(SUM(users), 0) AS users,
      COALESCE(SUM(new_users), 0) AS new_users,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(page_depth, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS page_depth,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(avg_visit_duration_seconds, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS avg_duration,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(bounce_rate, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS bounce_rate
    FROM canonical_fact_user_behavior_daily
    WHERE source_key = 'yandex_metrika'
      AND analytics_account_id IN (${buildInClause(counterIds)})
      AND report_date >= ?
      AND report_date <= ?
    GROUP BY ${userIdExpr}, CASE WHEN ${hasUserIdExpr} THEN 1 ELSE 0 END, COALESCE(traffic_source_id, traffic_source, '')
    ORDER BY visits DESC, has_user_id DESC, user_id ASC, traffic_source ASC
  `;
  const [rows] = await pool.execute<CanonicalUserBehaviorRow[]>(sql, [...counterIds, from, to]);
  const { userDirections } = workbookData;
  return rows.map((row) => {
    const hasUserId = asNumber(row.has_user_id) === 1;
    const userId = hasUserId ? String(Math.trunc(asNumber(row.user_id))) : "";
    return {
      user_id: userId,
      has_user_id: hasUserId,
      traffic_source: asString(row.traffic_source) || "Unknown traffic",
      direction: hasUserId ? userDirections.get(userId) ?? null : null,
      visits: Math.round(asNumber(row.visits)),
      users: Math.round(asNumber(row.users)),
      new_users: Math.round(asNumber(row.new_users)),
      page_depth: Number(asNumber(row.page_depth).toFixed(2)),
      avg_duration: Number(asNumber(row.avg_duration).toFixed(2)),
      bounce_rate: Number(asNumber(row.bounce_rate).toFixed(2)),
    };
  });
}

async function queryLegacyUserSummary(
  counterIds: string[],
  from: string,
  to: string,
  workbookData: ParsedAbbottWorkbook,
): Promise<AbbottBiUserSummaryRow[]> {
  const trafficSourceSql = buildTrafficSourceSql("params.traffic_id");
  const hasUserIdExpr = "(param_level_2 REGEXP '^[0-9]+$' AND CAST(param_level_2 AS UNSIGNED) > 0)";
  const userIdExpr = `CASE WHEN ${hasUserIdExpr} THEN CAST(param_level_2 AS UNSIGNED) ELSE NULL END`;
  const sql = `
    SELECT
      ${userIdExpr} AS user_id,
      CASE WHEN ${hasUserIdExpr} THEN 1 ELSE 0 END AS has_user_id,
      ${trafficSourceSql} AS traffic_source,
      COALESCE(SUM(visits), 0) AS visits,
      COALESCE(SUM(users), 0) AS users,
      COALESCE(SUM(newUsers), 0) AS new_users,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(pageDepth, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS page_depth,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(avgVDS, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS avg_duration,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(bounceRate, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS bounce_rate
    FROM yandex_metrika_params params
    LEFT JOIN yandex_metrika_traffic traffic
      ON traffic.traffic_id = params.traffic_id
    WHERE params.counter_id IN (${buildInClause(counterIds)})
      AND date >= ?
      AND date <= ?
    GROUP BY ${userIdExpr}, CASE WHEN ${hasUserIdExpr} THEN 1 ELSE 0 END, params.traffic_id
    ORDER BY visits DESC, has_user_id DESC, user_id ASC, traffic_source ASC
  `;
  const [rows] = await pool.execute<LegacyUserSummaryRow[]>(sql, [...counterIds, from, to]);
  const { userDirections } = workbookData;
  return rows.map((row) => {
    const hasUserId = asNumber(row.has_user_id) === 1;
    const userId = hasUserId ? String(Math.trunc(asNumber(row.user_id))) : "";
    return {
      user_id: userId,
      has_user_id: hasUserId,
      traffic_source: asString(row.traffic_source) || "Unknown traffic",
      direction: hasUserId ? userDirections.get(userId) ?? null : null,
      visits: Math.round(asNumber(row.visits)),
      users: Math.round(asNumber(row.users)),
      new_users: Math.round(asNumber(row.new_users)),
      page_depth: Number(asNumber(row.page_depth).toFixed(2)),
      avg_duration: Number(asNumber(row.avg_duration).toFixed(2)),
      bounce_rate: Number(asNumber(row.bounce_rate).toFixed(2)),
    };
  });
}

async function queryCanonicalTrafficSummary(
  counterIds: string[],
  from: string,
  to: string,
): Promise<AbbottBiUserSummaryRow[]> {
  const trafficScope = (await hasCanonicalTrafficSourceRows(counterIds, from, to)) ? "other" : "traffic";
  const sql = `
    SELECT
      COALESCE(NULLIF(traffic_source, ''), NULLIF(utm_source, ''), 'Unknown traffic') AS traffic_source,
      COALESCE(SUM(visits), 0) AS visits,
      COALESCE(SUM(users), 0) AS users,
      COALESCE(SUM(new_users), 0) AS new_users,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(page_depth, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS page_depth,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(avg_visit_duration_seconds, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS avg_duration,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(bounce_rate, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS bounce_rate
    FROM canonical_fact_site_analytics_daily
    WHERE source_key = 'yandex_metrika'
      AND analytics_account_id IN (${buildInClause(counterIds)})
      AND analytics_scope = ?
      AND report_date >= ?
      AND report_date <= ?
    GROUP BY COALESCE(NULLIF(traffic_source, ''), NULLIF(utm_source, ''), 'Unknown traffic')
    ORDER BY visits DESC, users DESC, traffic_source ASC
  `;
  const [rows] = await pool.execute<CanonicalTrafficSummaryRow[]>(sql, [...counterIds, trafficScope, from, to]);
  return rows.map((row) => ({
    user_id: "",
    has_user_id: false,
    traffic_source: asString(row.traffic_source) || "Unknown traffic",
    direction: null,
    visits: Math.round(asNumber(row.visits)),
    users: Math.round(asNumber(row.users)),
    new_users: Math.round(asNumber(row.new_users)),
    page_depth: Number(asNumber(row.page_depth).toFixed(2)),
    avg_duration: Number(asNumber(row.avg_duration).toFixed(2)),
    bounce_rate: Number(asNumber(row.bounce_rate).toFixed(2)),
  }));
}

async function queryCanonicalTrafficSummarySafe(counterIds: string[], from: string, to: string) {
  try {
    return await queryCanonicalTrafficSummary(counterIds, from, to);
  } catch (error) {
    console.warn("Abbott canonical traffic summary is not available", error);
    return [];
  }
}

async function queryUserSummary(
  counterIds: string[],
  from: string,
  to: string,
  workbookData: ParsedAbbottWorkbook,
): Promise<AbbottBiUserSummaryRow[]> {
  let rows: AbbottBiUserSummaryRow[];
  if (await hasCanonicalUserBehaviorRows(counterIds, from, to)) {
    rows = await queryCanonicalUserSummary(counterIds, from, to, workbookData);
  } else {
    rows = await queryLegacyUserSummary(counterIds, from, to, workbookData);
  }
  return rows.length > 0 ? rows : queryCanonicalTrafficSummary(counterIds, from, to);
}

function normalizeTimeBucketsByPage(rows: LegacyTimeBucketPageRow[]) {
  const byUrl = new Map<string, LegacyTimeBucketCountRow[]>();
  rows.forEach((row) => {
    const url = asString(row.url);
    if (!url) return;
    const current = byUrl.get(url) ?? [];
    current.push({
      bucket_id: row.bucket_id,
      users: row.users,
    } as LegacyTimeBucketCountRow);
    byUrl.set(url, current);
  });
  return Array.from(byUrl.entries()).map(([url, bucketRows]) => ({
    url,
    buckets: normalizeTimeBuckets(bucketRows),
  }));
}

async function queryCanonicalUserActions(
  counterIds: string[],
  from: string,
  to: string,
  workbookData: ParsedAbbottWorkbook,
): Promise<AbbottBiUserActionRow[]> {
  const hasUserIdExpr = "(user_id REGEXP '^[0-9]+$' AND CAST(user_id AS UNSIGNED) > 0)";
  const userIdExpr = `CASE WHEN ${hasUserIdExpr} THEN CAST(user_id AS UNSIGNED) ELSE NULL END`;
  const sql = `
    SELECT
      ${userIdExpr} AS user_id,
      CASE WHEN ${hasUserIdExpr} THEN 1 ELSE 0 END AS has_user_id,
      MAX(COALESCE(traffic_source, CONCAT('traffic_id:', COALESCE(traffic_source_id, 'unknown')))) AS traffic_source,
      MAX(COALESCE(start_url, '')) AS start_url,
      MAX(COALESCE(end_url, '')) AS end_url,
      COALESCE(SUM(visits), 0) AS visits,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(page_depth, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS page_depth,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(avg_visit_duration_seconds, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS avg_duration
    FROM canonical_fact_user_behavior_daily
    WHERE source_key = 'yandex_metrika'
      AND analytics_account_id IN (${buildInClause(counterIds)})
      AND report_date >= ?
      AND report_date <= ?
    GROUP BY
      ${userIdExpr},
      CASE WHEN ${hasUserIdExpr} THEN 1 ELSE 0 END,
      COALESCE(traffic_source_id, traffic_source, ''),
      COALESCE(start_url, ''),
      COALESCE(end_url, '')
    ORDER BY has_user_id DESC, user_id ASC, visits DESC, traffic_source ASC, start_url ASC, end_url ASC
  `;
  const [rows] = await pool.execute<CanonicalUserBehaviorRow[]>(sql, [...counterIds, from, to]);
  const { userDirections } = workbookData;
  return rows.map((row) => {
    const hasUserId = asNumber(row.has_user_id) === 1;
    const userId = hasUserId ? String(Math.trunc(asNumber(row.user_id))) : "";
    return {
      user_id: userId,
      has_user_id: hasUserId,
      traffic_source: asString(row.traffic_source) || "Unknown traffic",
      direction: hasUserId ? userDirections.get(userId) ?? null : null,
      start_url: asString(row.start_url),
      end_url: asString(row.end_url),
      visits: Math.round(asNumber(row.visits)),
      page_depth: Number(asNumber(row.page_depth).toFixed(2)),
      avg_duration: Number(asNumber(row.avg_duration).toFixed(2)),
    };
  });
}

async function queryLegacyUserActions(
  counterIds: string[],
  from: string,
  to: string,
  workbookData: ParsedAbbottWorkbook,
): Promise<AbbottBiUserActionRow[]> {
  const trafficSourceSql = buildTrafficSourceSql("params.traffic_id");
  const hasUserIdExpr = "(params.param_level_2 REGEXP '^[0-9]+$' AND CAST(params.param_level_2 AS UNSIGNED) > 0)";
  const userIdExpr = `CASE WHEN ${hasUserIdExpr} THEN CAST(params.param_level_2 AS UNSIGNED) ELSE NULL END`;
  const sql = `
    SELECT
      ${userIdExpr} AS user_id,
      CASE WHEN ${hasUserIdExpr} THEN 1 ELSE 0 END AS has_user_id,
      ${trafficSourceSql} AS traffic_source,
      COALESCE(params.startURL, '') AS start_url,
      COALESCE(params.endURL, '') AS end_url,
      COALESCE(SUM(visits), 0) AS visits,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(pageDepth, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS page_depth,
      CASE WHEN COALESCE(SUM(visits), 0) > 0
        THEN ROUND(SUM(COALESCE(avgVDS, 0) * visits) / SUM(visits), 2)
        ELSE 0
      END AS avg_duration
    FROM yandex_metrika_params params
    LEFT JOIN yandex_metrika_traffic traffic
      ON traffic.traffic_id = params.traffic_id
    WHERE params.counter_id IN (${buildInClause(counterIds)})
      AND params.date >= ?
      AND params.date <= ?
    GROUP BY
      ${userIdExpr},
      CASE WHEN ${hasUserIdExpr} THEN 1 ELSE 0 END,
      params.traffic_id,
      COALESCE(params.startURL, ''),
      COALESCE(params.endURL, '')
    ORDER BY has_user_id DESC, user_id ASC, visits DESC, traffic_source ASC, start_url ASC, end_url ASC
  `;
  const [rows] = await pool.execute<LegacyUserActionRow[]>(sql, [...counterIds, from, to]);
  const { userDirections } = workbookData;
  return rows.map((row) => {
    const hasUserId = asNumber(row.has_user_id) === 1;
    const userId = hasUserId ? String(Math.trunc(asNumber(row.user_id))) : "";
    return {
      user_id: userId,
      has_user_id: hasUserId,
      traffic_source: asString(row.traffic_source) || "Unknown traffic",
      direction: hasUserId ? userDirections.get(userId) ?? null : null,
      start_url: asString(row.start_url),
      end_url: asString(row.end_url),
      visits: Math.round(asNumber(row.visits)),
      page_depth: Number(asNumber(row.page_depth).toFixed(2)),
      avg_duration: Number(asNumber(row.avg_duration).toFixed(2)),
    };
  });
}

async function queryUserActions(
  counterIds: string[],
  from: string,
  to: string,
  workbookData: ParsedAbbottWorkbook,
): Promise<AbbottBiUserActionRow[]> {
  if (await hasCanonicalUserBehaviorRows(counterIds, from, to)) {
    return queryCanonicalUserActions(counterIds, from, to, workbookData);
  }
  return queryLegacyUserActions(counterIds, from, to, workbookData);
}

async function queryCanonicalPageStatRows(counterIds: string[], from: string, to: string) {
  const sql = `
    SELECT
      COALESCE(page_title, '') AS page_title,
      COALESCE(page_url, '') AS url,
      COALESCE(SUM(pageviews), 0) AS pageviews,
      COALESCE(SUM(users), 0) AS users
    FROM canonical_fact_site_analytics_daily
    WHERE source_key = 'yandex_metrika'
      AND analytics_account_id IN (${buildInClause(counterIds)})
      AND analytics_scope = 'page'
      AND report_date >= ?
      AND report_date <= ?
    GROUP BY COALESCE(page_title, ''), COALESCE(page_url, '')
    HAVING pageviews > 0 OR users > 0
    ORDER BY pageviews DESC, users DESC, page_title ASC
  `;
  const [rows] = await pool.execute<CanonicalPageStatRow[]>(sql, [...counterIds, from, to]);
  return rows;
}

async function queryLegacyPageStatRows(counterIds: string[], from: string, to: string) {
  const sql = `
    SELECT
      COALESCE(page_name, '') AS page_title,
      COALESCE(url, '') AS url,
      COALESCE(SUM(page_view), 0) AS pageviews,
      COALESCE(SUM(users), 0) AS users
    FROM yandex_metrika_internal
    WHERE counter_id IN (${buildInClause(counterIds)})
      AND date >= ?
      AND date <= ?
    GROUP BY COALESCE(page_name, ''), COALESCE(url, '')
    ORDER BY pageviews DESC, users DESC, page_title ASC
  `;
  const [rows] = await pool.execute<LegacyPageStatRow[]>(sql, [...counterIds, from, to]);
  return rows;
}

async function queryPageStats(
  counterIds: string[],
  from: string,
  to: string,
  workbookData: ParsedAbbottWorkbook,
  useAbbottMetadata: boolean,
): Promise<AbbottBiPageStatRow[]> {
  const canonicalRows = await queryCanonicalPageStatRows(counterIds, from, to);
  const rows = canonicalRows.length > 0 ? canonicalRows : await queryLegacyPageStatRows(counterIds, from, to);
  const { contentByTitle, contentByTitleAndType, contentBySlug, userDirections } = workbookData;
  const byPage = new Map<string, AbbottBiPageStatRow & { is_hidden?: boolean }>();
  rows
    .forEach((row) => {
      const pageTitle = asString(row.page_title);
      const url = normalizeAbbottPageUrl(row.url);
      const pageMetadata = useAbbottMetadata
        ? resolveAbbottPageMetadata(
            asString(row.url),
            pageTitle,
            contentByTitle,
            contentByTitleAndType,
            contentBySlug,
            userDirections,
          )
        : { direction: null, material_type: null, access: null };
      const inferredMaterialType = useAbbottMetadata ? inferAbbottMaterialTypeFromUrl(url) : null;
      const contentMeta =
        (inferredMaterialType ? contentByTitleAndType.get(`${inferredMaterialType}::${pageTitle}`) : null) ??
        contentByTitle.get(pageTitle) ??
        contentBySlug.get(extractAbbottSlugFromUrl(url) ?? "");
      const key = `${pageTitle}\n${url}`;
      const current = byPage.get(key) ?? {
        page_title: pageTitle,
        url,
        direction: pageMetadata.direction,
        material_type: pageMetadata.material_type,
        access: pageMetadata.access,
        is_hidden: contentMeta?.is_active === false,
        pageviews: 0,
        users: 0,
        ...emptyBitrixMetrics(),
      };
      if (!useAbbottMetadata || !isAbbottUtilityPageUrl(url)) {
        current.direction = current.direction ?? pageMetadata.direction;
        current.material_type = current.material_type ?? pageMetadata.material_type;
        current.access = current.access ?? pageMetadata.access;
      } else {
        current.direction = null;
        current.material_type = null;
        current.access = null;
      }
      current.is_hidden = current.is_hidden || contentMeta?.is_active === false;
      current.pageviews += Math.round(asNumber(row.pageviews));
      current.users += Math.round(asNumber(row.users));
      byPage.set(key, current);
    })
  return Array.from(byPage.values())
    .filter((row) => !row.is_hidden)
    .filter((row) => row.url || row.page_title)
    .sort((a, b) => {
      if (b.pageviews !== a.pageviews) return b.pageviews - a.pageviews;
      if (b.users !== a.users) return b.users - a.users;
      return a.page_title.localeCompare(b.page_title, "ru");
    });
}

async function queryReturningFallback(counterIds: string[], from: string, to: string) {
  const sql = `
    SELECT
      COALESCE(url, '') AS url,
      COALESCE(SUM(page_view), 0) AS visits
    FROM yandex_metrika_returned
    WHERE counter_id IN (${buildInClause(counterIds)})
      AND date >= ?
      AND date <= ?
    GROUP BY COALESCE(url, '')
    ORDER BY visits DESC, url ASC
  `;
  const [rows] = await pool.execute<LegacyReturningFallbackRow[]>(sql, [...counterIds, from, to]);
  return rows
    .map((row) => ({
      url: asString(row.url),
      visits: Math.round(asNumber(row.visits)),
    }))
    .filter((row) => row.url);
}

async function queryCanonicalTimeBuckets(
  counterIds: string[],
  from: string,
  to: string,
  workbookData: ParsedAbbottWorkbook,
): Promise<AbbottBiTimeBuckets> {
  const { generalMaterials } = workbookData;
  const materialUrls = [...new Set(generalMaterials.map((row) => row.url).filter(Boolean))];
  const overallBucketCase = buildTimeBucketCase(
    "SUM(COALESCE(avg_visit_duration_seconds, 0) * visits) / SUM(visits)",
  );
  const baseParams = [...counterIds, from, to];

  const overallSql = `
    SELECT bucket_id, COUNT(*) AS users
    FROM (
      SELECT
        CAST(user_id AS UNSIGNED) AS user_id,
        ${overallBucketCase} AS bucket_id
      FROM canonical_fact_user_behavior_daily
      WHERE source_key = 'yandex_metrika'
        AND analytics_account_id IN (${buildInClause(counterIds)})
        AND report_date >= ?
        AND report_date <= ?
        AND user_id REGEXP '^[0-9]+$'
        AND CAST(user_id AS UNSIGNED) > 0
      GROUP BY CAST(user_id AS UNSIGNED)
    ) grouped_users
    GROUP BY bucket_id
  `;
  const [overallRows] = await pool.execute<LegacyTimeBucketCountRow[]>(overallSql, baseParams);

  let materialsRows: LegacyTimeBucketCountRow[] = [];
  if (materialUrls.length > 0) {
    const materialsBucketCase = buildTimeBucketCase(
      "SUM(COALESCE(avg_visit_duration_seconds, 0) * visits) / SUM(visits)",
    );
    const materialsSql = `
      SELECT bucket_id, COUNT(*) AS users
      FROM (
        SELECT
          CAST(user_id AS UNSIGNED) AS user_id,
          ${materialsBucketCase} AS bucket_id
        FROM canonical_fact_user_behavior_daily
        WHERE source_key = 'yandex_metrika'
          AND analytics_account_id IN (${buildInClause(counterIds)})
          AND report_date >= ?
          AND report_date <= ?
          AND user_id REGEXP '^[0-9]+$'
          AND CAST(user_id AS UNSIGNED) > 0
          AND end_url IN (${buildInClause(materialUrls)})
        GROUP BY CAST(user_id AS UNSIGNED)
      ) grouped_material_users
      GROUP BY bucket_id
    `;
    const [rawMaterialsRows] = await pool.execute<LegacyTimeBucketCountRow[]>(materialsSql, [
      ...counterIds,
      from,
      to,
      ...materialUrls,
    ]);
    materialsRows = rawMaterialsRows;
  }

  const perPageBucketCase = buildTimeBucketCase(
    "SUM(COALESCE(avg_visit_duration_seconds, 0) * visits) / SUM(visits)",
  );
  const perPageSql = `
    SELECT
      end_url AS url,
      bucket_id,
      COUNT(*) AS users
    FROM (
      SELECT
        CAST(user_id AS UNSIGNED) AS user_id,
        COALESCE(end_url, '') AS end_url,
        ${perPageBucketCase} AS bucket_id
      FROM canonical_fact_user_behavior_daily
      WHERE source_key = 'yandex_metrika'
        AND analytics_account_id IN (${buildInClause(counterIds)})
        AND report_date >= ?
        AND report_date <= ?
        AND user_id REGEXP '^[0-9]+$'
        AND CAST(user_id AS UNSIGNED) > 0
        AND COALESCE(end_url, '') <> ''
      GROUP BY CAST(user_id AS UNSIGNED), COALESCE(end_url, '')
    ) grouped_page_users
    GROUP BY end_url, bucket_id
  `;
  const [perPageRows] = await pool.execute<LegacyTimeBucketPageRow[]>(perPageSql, baseParams);

  return {
    overall: normalizeTimeBuckets(overallRows),
    materials: normalizeTimeBuckets(materialsRows),
    by_page: normalizeTimeBucketsByPage(perPageRows),
  };
}

async function queryLegacyTimeBuckets(
  counterIds: string[],
  from: string,
  to: string,
  workbookData: ParsedAbbottWorkbook,
): Promise<AbbottBiTimeBuckets> {
  const { generalMaterials } = workbookData;
  const materialUrls = [...new Set(generalMaterials.map((row) => row.url).filter(Boolean))];
  const overallBucketCase = buildTimeBucketCase("SUM(COALESCE(avgVDS, 0) * visits) / SUM(visits)");
  const baseParams = [...counterIds, from, to];

  const overallSql = `
    SELECT bucket_id, COUNT(*) AS users
    FROM (
      SELECT
        CAST(param_level_2 AS UNSIGNED) AS user_id,
        ${overallBucketCase} AS bucket_id
      FROM yandex_metrika_params
      WHERE counter_id IN (${buildInClause(counterIds)})
        AND date >= ?
        AND date <= ?
        AND param_level_2 REGEXP '^[0-9]+$'
        AND CAST(param_level_2 AS UNSIGNED) > 0
      GROUP BY CAST(param_level_2 AS UNSIGNED)
    ) grouped_users
    GROUP BY bucket_id
  `;
  const [overallRows] = await pool.execute<LegacyTimeBucketCountRow[]>(overallSql, baseParams);

  let materialsRows: LegacyTimeBucketCountRow[] = [];
  if (materialUrls.length > 0) {
    const materialsBucketCase = buildTimeBucketCase("SUM(COALESCE(avgVDS, 0) * visits) / SUM(visits)");
    const materialsSql = `
      SELECT bucket_id, COUNT(*) AS users
      FROM (
        SELECT
          CAST(param_level_2 AS UNSIGNED) AS user_id,
          ${materialsBucketCase} AS bucket_id
        FROM yandex_metrika_params
        WHERE counter_id IN (${buildInClause(counterIds)})
          AND date >= ?
          AND date <= ?
          AND param_level_2 REGEXP '^[0-9]+$'
          AND CAST(param_level_2 AS UNSIGNED) > 0
          AND endURL IN (${buildInClause(materialUrls)})
        GROUP BY CAST(param_level_2 AS UNSIGNED)
      ) grouped_material_users
      GROUP BY bucket_id
    `;
    const [rawMaterialsRows] = await pool.execute<LegacyTimeBucketCountRow[]>(materialsSql, [
      ...counterIds,
      from,
      to,
      ...materialUrls,
    ]);
    materialsRows = rawMaterialsRows;
  }

  const perPageBucketCase = buildTimeBucketCase("SUM(COALESCE(avgVDS, 0) * visits) / SUM(visits)");
  const perPageSql = `
    SELECT
      end_url AS url,
      bucket_id,
      COUNT(*) AS users
    FROM (
      SELECT
        CAST(param_level_2 AS UNSIGNED) AS user_id,
        COALESCE(endURL, '') AS end_url,
        ${perPageBucketCase} AS bucket_id
      FROM yandex_metrika_params
      WHERE counter_id IN (${buildInClause(counterIds)})
        AND date >= ?
        AND date <= ?
        AND param_level_2 REGEXP '^[0-9]+$'
        AND CAST(param_level_2 AS UNSIGNED) > 0
        AND COALESCE(endURL, '') <> ''
      GROUP BY CAST(param_level_2 AS UNSIGNED), COALESCE(endURL, '')
    ) grouped_page_users
    GROUP BY end_url, bucket_id
  `;
  const [perPageRows] = await pool.execute<LegacyTimeBucketPageRow[]>(perPageSql, baseParams);

  return {
    overall: normalizeTimeBuckets(overallRows),
    materials: normalizeTimeBuckets(materialsRows),
    by_page: normalizeTimeBucketsByPage(perPageRows),
  };
}

async function queryTimeBuckets(
  counterIds: string[],
  from: string,
  to: string,
  workbookData: ParsedAbbottWorkbook,
): Promise<AbbottBiTimeBuckets> {
  if (await hasCanonicalUserBehaviorRows(counterIds, from, to)) {
    return queryCanonicalTimeBuckets(counterIds, from, to, workbookData);
  }
  return queryLegacyTimeBuckets(counterIds, from, to, workbookData);
}

async function queryExternalFactDaily(from: string, to: string) {
  const sql = `
    SELECT
      DATE(date) AS report_date,
      COALESCE(url, '') AS external_url,
      COALESCE(SUM(views), 0) AS outbound_clicks
    FROM yandex_metrika_external
    WHERE date >= ?
      AND date <= ?
      AND COALESCE(url, '') <> ''
    GROUP BY DATE(date), COALESCE(url, '')
    ORDER BY report_date ASC, outbound_clicks DESC, external_url ASC
  `;
  const [rows] = await pool.execute<LegacyExternalFactDailyRow[]>(sql, [from, to]);
  return rows
    .map((row) => ({
      report_date: asDateString(row.report_date),
      external_url: asString(row.external_url),
      outbound_clicks: Math.round(asNumber(row.outbound_clicks)),
    }))
    .filter((row) => row.report_date && row.external_url && row.outbound_clicks > 0);
}

function buildExternalClickRows(
  dailyRows: Array<{ report_date: string; external_url: string; outbound_clicks: number }>,
  workbookData: ParsedAbbottWorkbook,
): AbbottBiExternalClickRow[] {
  const { externalEvents } = workbookData;
  const eventByUrl = new Map(
    externalEvents.map((row) => [
      row.registration_url,
      {
        title: row.title,
        direction: row.direction,
      },
    ]),
  );

  const totals = new Map<string, AbbottBiExternalClickRow>();
  dailyRows.forEach((row) => {
    const current = totals.get(row.external_url) ?? {
      title: eventByUrl.get(row.external_url)?.title ?? null,
      direction: eventByUrl.get(row.external_url)?.direction ?? null,
      external_url: row.external_url,
      outbound_clicks: 0,
    };
    current.outbound_clicks += row.outbound_clicks;
    totals.set(row.external_url, current);
  });

  return Array.from(totals.values()).sort((a, b) => {
    if (b.outbound_clicks !== a.outbound_clicks) return b.outbound_clicks - a.outbound_clicks;
    return a.external_url.localeCompare(b.external_url);
  });
}

function buildReturningRows(
  from: string,
  to: string,
  legacyRows: Array<{ url: string; visits: number }>,
  workbookData: ParsedAbbottWorkbook,
  useAbbottMetadata: boolean,
): AbbottBiReturningRow[] {
  const { ymUrlReturn, urlReturnDirections, userDirections } = workbookData;
  const workbookTotals = new Map<string, AbbottBiReturningRow>();

  ymUrlReturn
    .filter((row) => row.date && row.date >= from && row.date <= to)
    .forEach((row) => {
      const current = workbookTotals.get(row.url) ?? {
        url: row.url,
        direction:
          urlReturnDirections.get(row.url) ??
          (useAbbottMetadata ? inferAbbottDirectionFromUrl(row.url, userDirections) : null) ??
          null,
        visits: 0,
        returning_1_day: 0,
        returning_2_7_days: 0,
        returning_8_31_days: 0,
      };
      current.visits += Math.round(row.visits);
      current.returning_1_day += Math.round(row.returning_1_day);
      current.returning_2_7_days += Math.round(row.returning_2_7_days);
      current.returning_8_31_days += Math.round(row.returning_8_31_days);
      workbookTotals.set(row.url, current);
    });

  const byUrl = new Map<string, AbbottBiReturningRow>();
  legacyRows.forEach((row) => {
    byUrl.set(row.url, {
      url: row.url,
      direction:
        urlReturnDirections.get(row.url) ??
        (useAbbottMetadata ? inferAbbottDirectionFromUrl(row.url, userDirections) : null) ??
        null,
      visits: row.visits,
      returning_1_day: 0,
      returning_2_7_days: 0,
      returning_8_31_days: 0,
    });
  });
  workbookTotals.forEach((row, url) => {
    byUrl.set(url, row);
  });

  return Array.from(byUrl.values()).sort((a, b) => {
    if (b.visits !== a.visits) return b.visits - a.visits;
    return a.url.localeCompare(b.url);
  });
}

function buildGeneralMaterialsRows(pageStats: AbbottBiPageStatRow[], workbookData: ParsedAbbottWorkbook): AbbottBiMaterialRow[] {
  const { generalMaterials } = workbookData;
  const byUrl = new Map(pageStats.map((row) => [row.url, row]));
  return generalMaterials.map<AbbottBiMaterialRow>((material) => {
    const stats = byUrl.get(material.url);
    return {
      material_name: material.name,
      url: material.url,
      pageviews: stats?.pageviews ?? 0,
      users: stats?.users ?? 0,
    };
  });
}

export function getDefaultAbbottCounterIds() {
  return ["90602537"];
}

export function getDefaultZarukuCounterIds() {
  return ["66624469", "99078698"];
}

async function loadPortalBiData(
  counterIds: string[],
  from: string,
  to: string,
  config: PortalBiConfig,
): Promise<AbbottBiData> {
  const normalizedCounterIds = counterIds.length > 0 ? counterIds : config.defaultCounterIds;
  const workbookData = loadPortalWorkbookData(config.useWorkbook);
  const bitrixAnalytics = config.useBitrix ? loadBitrixAnalyticsData() : { summary: null, rows: [] };
  const sessionJourneys = config.useBitrix ? loadBitrixSessionJourneysData() : emptySessionJourneysData();
  const [usersSummary, trafficSummary, userActions, pageStats, returningFallback, externalFactDaily, timeBuckets, returningApiPrototype] = await Promise.all([
    queryUserSummary(normalizedCounterIds, from, to, workbookData),
    queryCanonicalTrafficSummarySafe(normalizedCounterIds, from, to),
    queryUserActions(normalizedCounterIds, from, to, workbookData),
    queryPageStats(normalizedCounterIds, from, to, workbookData, config.useAbbottMetadata),
    queryReturningFallback(normalizedCounterIds, from, to),
    // This legacy table is Abbott-specific and does not store counter_id,
    // so the external layer is intentionally scoped to the Abbott dashboard only.
    config.useExternalClicks ? queryExternalFactDaily(from, to) : Promise.resolve([]),
    queryTimeBuckets(normalizedCounterIds, from, to, workbookData),
    config.useAbbottReturningApi ? queryAbbottReturningApi(normalizedCounterIds, from, to).catch(() => []) : Promise.resolve([]),
  ]);

  const bitrixPeriodActive = isAbbottBitrixPeriodActive(from, to, bitrixAnalytics.summary);
  const enrichedPageStats = bitrixPeriodActive
    ? enrichPageStatsWithBitrix(pageStats, bitrixAnalytics.rows)
    : pageStats.map((row) => ({ ...row, ...emptyBitrixMetrics() }));

  return {
    counters: normalizedCounterIds,
    users_summary: usersSummary,
    traffic_summary: trafficSummary,
    user_actions: userActions,
    page_stats: enrichedPageStats,
    bitrix_pages: bitrixAnalytics.rows,
    bitrix_summary: bitrixAnalytics.summary,
    bitrix_period_active: bitrixPeriodActive,
    session_journeys: sessionJourneys,
    external_events: workbookData.externalEvents,
    external_clicks: buildExternalClickRows(externalFactDaily, workbookData),
    time_buckets: timeBuckets,
    returning:
      returningApiPrototype.length > 0
        ? returningApiPrototype
        : buildReturningRows(from, to, returningFallback, workbookData, config.useAbbottMetadata),
    general_materials: buildGeneralMaterialsRows(enrichedPageStats, workbookData),
  };
}

export async function loadAbbottBiData(counterIds: string[], from: string, to: string): Promise<AbbottBiData> {
  return loadPortalBiData(counterIds, from, to, {
    defaultCounterIds: getDefaultAbbottCounterIds(),
    useWorkbook: true,
    useAbbottMetadata: true,
    useBitrix: true,
    useExternalClicks: true,
    useAbbottReturningApi: true,
  });
}

export async function loadZarukuBiData(counterIds: string[], from: string, to: string): Promise<AbbottBiData> {
  return loadPortalBiData(counterIds, from, to, {
    defaultCounterIds: getDefaultZarukuCounterIds(),
    useWorkbook: false,
    useAbbottMetadata: false,
    useBitrix: false,
    useExternalClicks: false,
    useAbbottReturningApi: false,
  });
}
