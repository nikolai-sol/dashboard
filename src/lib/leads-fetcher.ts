import Papa from "papaparse";
import * as XLSX from "xlsx";
import { normalizeManualPlatformId } from "@/lib/manual-data-fetcher";

export interface LeadRow {
  date: string;
  platform: string;
  channel: string;
  source: string;
  leads: number;
  qualified_leads: number;
  revenue: number;
  notes: string;
}

export type LeadsUploadPayload = {
  filename: string;
  mime_type?: string;
  content_base64: string;
};

export type LeadsSourceConfig = {
  sheet_url?: string;
  inline_rows?: unknown;
  upload_file?: unknown;
  review?: unknown;
};

export type LeadsParseResult = {
  input_url: string;
  fetch_url: string;
  headers: string[];
  raw_rows: number;
  rows: LeadRow[];
};

export type LeadsPreviewIssue = {
  severity: "error" | "warn" | "info";
  code: string;
  message: string;
};

export type LeadsPlatformReview = {
  input_platform: string;
  normalized_platform: string;
  row_count: number;
  channels: string[];
  status: "canonical_bound" | "unresolved" | "ignored";
  bound_platform: string | null;
  available_targets: string[];
};

export type LeadsChannelReview = {
  binding_key: string;
  input_platform: string;
  bound_platform: string | null;
  input_channel: string;
  normalized_channel: string;
  row_count: number;
  leads: number;
  status: "canonical_bound" | "platform_only" | "unresolved";
  bound_channel: string | null;
  available_targets: string[];
  candidates: Array<{
    channel: string;
    score: number;
  }>;
};

export type LeadsPreviewAnalysis = {
  status: "ok" | "warn" | "error";
  sheet_url_input: string;
  sheet_url_fetch: string;
  rows_total: number;
  rows_parsed: number;
  dated_rows: number;
  channels: number;
  platforms_detected: string[];
  selected_platforms: string[];
  binding_summary: {
    canonical_bound: number;
    unresolved: number;
    ignored: number;
  };
  platform_review: LeadsPlatformReview[];
  channel_binding_summary: {
    canonical_bound: number;
    platform_only: number;
    unresolved: number;
  };
  channel_review: LeadsChannelReview[];
  issues: LeadsPreviewIssue[];
  sample_rows: LeadRow[];
};

export type LeadsPlatformBindingMap = Record<string, string>;
export type LeadsChannelBindingMap = Record<string, string>;

export type LeadsReviewedConfig = {
  review_version: 1;
  status: "confirmed";
  confirmed_at: string;
  sheet_url_input: string;
  sheet_url_fetch: string;
  rows_total: number;
  rows_parsed: number;
  dated_rows: number;
  channels: number;
  platforms_detected: string[];
  selected_platforms: string[];
  platform_bindings: LeadsPlatformBindingMap;
  binding_summary: LeadsPreviewAnalysis["binding_summary"];
  selected_channels: string[];
  channel_bindings: LeadsChannelBindingMap;
  channel_binding_summary: LeadsPreviewAnalysis["channel_binding_summary"];
  issues: LeadsPreviewIssue[];
};

export type LeadsConfirmResult = {
  analysis: LeadsPreviewAnalysis;
  reviewed_source_config: Record<string, unknown>;
};

export type LeadsPlatformConversions = Record<string, number>;
export type ConfirmedLeadChannelRow = {
  date: string;
  bound_platform: string;
  bound_channel: string;
  leads: number;
};

const CACHE_TTL = 5 * 60 * 1000;
const cacheByUrl = new Map<string, { parsed: LeadsParseResult; ts: number }>();

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

function normalizeSheetUrl(sheetUrl: string): string {
  const trimmed = sheetUrl.trim();
  if (!trimmed) return "";

  const url = new URL(trimmed);
  if (url.pathname.includes("/spreadsheets/d/")) {
    const idMatch = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (idMatch) {
      return `https://docs.google.com/spreadsheets/d/${idMatch[1]}/export?format=csv`;
    }
  }
  if (!url.searchParams.get("format") && !url.searchParams.get("output")) {
    url.searchParams.set("format", "csv");
  }
  return url.toString();
}

function parseUploadPayload(value: unknown): LeadsUploadPayload | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<LeadsUploadPayload>;
  const filename = String(input.filename ?? "").trim();
  const contentBase64 = String(input.content_base64 ?? "").trim();
  if (!filename || !contentBase64) return null;
  return {
    filename,
    mime_type: input.mime_type ? String(input.mime_type) : undefined,
    content_base64: contentBase64,
  };
}

function toObjectsFromWorksheet(worksheet: XLSX.WorkSheet): Record<string, unknown>[] {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
    raw: true,
  }).map((row) => {
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[normalizeHeader(key)] = value;
    }
    return normalized;
  });
}

function parseInlineRows(value: unknown): LeadRow[] {
  if (!Array.isArray(value)) return [];
  return value.map((row) => normalizeLeadRow((row ?? {}) as Record<string, unknown>)).filter((row) => row.platform && row.leads > 0);
}

function toNum(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const normalized = String(value).trim().replace(/\s+/g, "").replace(/,/g, ".");
  const num = Number(normalized);
  return Number.isFinite(num) ? num : 0;
}

function normalizeDate(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const dmY = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (dmY) {
    const day = Number(dmY[1]);
    const month = Number(dmY[2]);
    let year = Number(dmY[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
}

function normalizeLeadRow(raw: Record<string, unknown>): LeadRow {
  return {
    date: normalizeDate(raw.date ?? raw.report_date ?? raw.day),
    platform: normalizeManualPlatformId(raw.platform ?? raw.source_platform ?? raw.utm_source ?? raw.source),
    channel: String(raw.channel ?? raw.campaign ?? raw.campaign_name ?? raw.utm_campaign ?? "").trim(),
    source: String(raw.source ?? raw.origin ?? raw.utm_source ?? "").trim(),
    leads: Math.max(0, toNum(raw.leads)),
    qualified_leads: Math.max(0, toNum(raw.qualified_leads)),
    revenue: Math.max(0, toNum(raw.revenue)),
    notes: String(raw.notes ?? "").trim(),
  };
}

function normalizeChannelValue(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

function tokenizeChannel(raw: string): string[] {
  return normalizeChannelValue(raw)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function makeChannelBindingKey(platform: string, channel: string): string {
  return `${normalizeManualPlatformId(platform)}|${normalizeChannelValue(channel)}`;
}

function scoreChannelMatch(inputChannel: string, candidateChannel: string): number {
  const left = normalizeChannelValue(inputChannel);
  const right = normalizeChannelValue(candidateChannel);
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = new Set(tokenizeChannel(inputChannel));
  const rightTokens = new Set(tokenizeChannel(candidateChannel));
  if (!leftTokens.size || !rightTokens.size) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  if (left.includes(right) || right.includes(left)) {
    return Math.max(jaccard, 0.9);
  }

  return Number(jaccard.toFixed(4));
}

function parseCsvText(csvText: string): { headers: string[]; raw_rows: number; rows: LeadRow[] } {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: true,
    transformHeader: normalizeHeader,
  });
  const headers = Array.isArray(parsed.meta.fields) ? parsed.meta.fields : [];
  const rows = parsed.data.map((row) => normalizeLeadRow(row)).filter((row) => row.platform && row.leads > 0);
  return { headers, raw_rows: parsed.data.length, rows };
}

function parseXlsxBuffer(buffer: Buffer): { headers: string[]; raw_rows: number; rows: LeadRow[] } {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return { headers: [], raw_rows: 0, rows: [] };
  const worksheet = workbook.Sheets[firstSheetName];
  const objects = toObjectsFromWorksheet(worksheet);
  const headers = objects[0] ? Object.keys(objects[0]) : [];
  const rows = objects.map((row) => normalizeLeadRow(row)).filter((row) => row.platform && row.leads > 0);
  return { headers, raw_rows: objects.length, rows };
}

function parseUploadFile(upload: LeadsUploadPayload): { headers: string[]; raw_rows: number; rows: LeadRow[] } {
  const filename = upload.filename.toLowerCase();
  const mimeType = String(upload.mime_type ?? "").toLowerCase();
  const buffer = Buffer.from(upload.content_base64, "base64");

  if (
    filename.endsWith(".xlsx") ||
    filename.endsWith(".xls") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel")
  ) {
    return parseXlsxBuffer(buffer);
  }

  return parseCsvText(buffer.toString("utf-8"));
}

function extractReviewBindings(sourceConfig: LeadsSourceConfig): Record<string, string> {
  const review = sourceConfig.review;
  if (!review || typeof review !== "object") return {};
  const bindings = (review as Record<string, unknown>).platform_bindings;
  if (!bindings || typeof bindings !== "object") return {};
  return Object.fromEntries(
    Object.entries(bindings as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]),
  );
}

function extractReviewChannelBindings(sourceConfig: LeadsSourceConfig): Record<string, string> {
  const review = sourceConfig.review;
  if (!review || typeof review !== "object") return {};
  const bindings = (review as Record<string, unknown>).channel_bindings;
  if (!bindings || typeof bindings !== "object") return {};
  return Object.fromEntries(
    Object.entries(bindings as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]),
  );
}

function reviewStatus(sourceConfig: LeadsSourceConfig): string {
  const review = sourceConfig.review;
  if (!review || typeof review !== "object") return "";
  return String((review as Record<string, unknown>).status ?? "").trim().toLowerCase();
}

export async function fetchLeadsFromSourceConfig(sourceConfig: LeadsSourceConfig): Promise<LeadsParseResult> {
  const inputUrl = String(sourceConfig.sheet_url ?? "").trim();

  const inlineRows = parseInlineRows(sourceConfig.inline_rows);
  if (inlineRows.length) {
    return {
      input_url: inputUrl,
      fetch_url: "inline_rows",
      headers: Object.keys((sourceConfig.inline_rows as Record<string, unknown>[])[0] ?? {}).map(normalizeHeader),
      raw_rows: inlineRows.length,
      rows: inlineRows,
    };
  }

  const upload = parseUploadPayload(sourceConfig.upload_file);
  if (upload) {
    const parsed = parseUploadFile(upload);
    return {
      input_url: inputUrl,
      fetch_url: `upload:${upload.filename}`,
      headers: parsed.headers,
      raw_rows: parsed.raw_rows,
      rows: parsed.rows,
    };
  }

  const fetchUrl = normalizeSheetUrl(inputUrl);
  if (!fetchUrl) {
    return {
      input_url: inputUrl,
      fetch_url: "",
      headers: [],
      raw_rows: 0,
      rows: [],
    };
  }

  const cached = cacheByUrl.get(fetchUrl);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.parsed;
  }

  const response = await fetch(fetchUrl, { cache: "no-store", redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Leads fetch failed with status ${response.status}`);
  }
  const text = await response.text();
  const parsed = {
    input_url: inputUrl,
    fetch_url: fetchUrl,
    ...parseCsvText(text),
  };
  cacheByUrl.set(fetchUrl, { parsed, ts: Date.now() });
  return parsed;
}

export async function analyzeLeadSourceConfig(
  sourceConfig: LeadsSourceConfig,
  selectedPlatforms: string[],
  selectedChannels: string[] = [],
): Promise<LeadsPreviewAnalysis> {
  const parsed = await fetchLeadsFromSourceConfig(sourceConfig);
  const issues: LeadsPreviewIssue[] = [];
  const savedBindings = extractReviewBindings(sourceConfig);
  const savedChannelBindings = extractReviewChannelBindings(sourceConfig);
  const selectedSet = new Set(selectedPlatforms.map((item) => normalizeManualPlatformId(item)).filter(Boolean));
  const normalizedChannelTargets = Array.from(
    new Map(
      selectedChannels
        .map((channel) => String(channel).trim())
        .filter(Boolean)
        .map((channel) => [normalizeChannelValue(channel), channel] as const),
    ).values(),
  );

  if (!parsed.fetch_url && !parsed.rows.length) {
    issues.push({ severity: "error", code: "MISSING_INPUT", message: "Sheet URL is empty and no uploaded leads file is attached." });
  }
  if (!parsed.rows.length) {
    issues.push({ severity: "error", code: "NO_ROWS", message: "No parsable leads rows found." });
  }

  const datedRows = parsed.rows.filter((row) => Boolean(row.date)).length;
  if (parsed.rows.length > 0 && datedRows < parsed.rows.length) {
    issues.push({ severity: "warn", code: "MISSING_DATES", message: `${parsed.rows.length - datedRows} rows have no valid date.` });
  }

  const groups = new Map<string, { row_count: number; channels: Set<string> }>();
  for (const row of parsed.rows) {
    const key = row.platform || "unknown";
    if (!groups.has(key)) {
      groups.set(key, { row_count: 0, channels: new Set<string>() });
    }
    const group = groups.get(key)!;
    group.row_count += 1;
    if (row.channel) group.channels.add(row.channel);
  }

  const platformReview: LeadsPlatformReview[] = Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([platformKey, group]) => {
      const saved = String(savedBindings[platformKey] ?? "").trim();
      const normalizedSaved = saved && saved !== "__ignore__" ? normalizeManualPlatformId(saved) : saved;
      const defaultMatch = selectedSet.has(platformKey) ? platformKey : "";
      const boundPlatform = normalizedSaved && normalizedSaved !== "__ignore__" ? normalizedSaved : defaultMatch || null;
      const status: LeadsPlatformReview["status"] =
        saved === "__ignore__"
          ? "ignored"
          : boundPlatform && selectedSet.has(boundPlatform)
            ? "canonical_bound"
            : "unresolved";
      return {
        input_platform: platformKey,
        normalized_platform: platformKey,
        row_count: group.row_count,
        channels: Array.from(group.channels).sort((a, b) => a.localeCompare(b)),
        status,
        bound_platform: status === "canonical_bound" ? boundPlatform : null,
        available_targets: selectedPlatforms,
      };
    });

  const unresolvedCount = platformReview.filter((item) => item.status === "unresolved").length;
  const ignoredCount = platformReview.filter((item) => item.status === "ignored").length;
  const boundCount = platformReview.filter((item) => item.status === "canonical_bound").length;

  if (unresolvedCount > 0) {
    issues.push({ severity: parsed.rows.length ? "warn" : "error", code: "UNRESOLVED_PLATFORMS", message: `${unresolvedCount} lead platform groups are not bound to selected dashboard platforms.` });
  }
  if (!selectedPlatforms.length) {
    issues.push({ severity: "warn", code: "NO_TARGET_PLATFORMS", message: "No dashboard platforms are currently available for leads binding." });
  }

  const platformBindingByInput = new Map(
    platformReview.map((item) => [item.input_platform, item.status === "canonical_bound" ? item.bound_platform : null] as const),
  );

  const channelGroups = new Map<
    string,
    { input_platform: string; channel: string; row_count: number; leads: number }
  >();
  for (const row of parsed.rows) {
    const key = makeChannelBindingKey(row.platform, row.channel);
    if (!channelGroups.has(key)) {
      channelGroups.set(key, {
        input_platform: row.platform,
        channel: row.channel,
        row_count: 0,
        leads: 0,
      });
    }
    const group = channelGroups.get(key)!;
    group.row_count += 1;
    group.leads += row.leads;
  }

  const channelReview: LeadsChannelReview[] = Array.from(channelGroups.entries())
    .sort((a, b) => a[1].input_platform.localeCompare(b[1].input_platform) || a[1].channel.localeCompare(b[1].channel))
    .map(([bindingKey, group]) => {
      const boundPlatform = platformBindingByInput.get(group.input_platform) ?? null;
      const explicitBinding = String(savedChannelBindings[bindingKey] ?? "").trim();
      const normalizedExplicit = explicitBinding ? normalizeChannelValue(explicitBinding) : "";
      const candidates = normalizedChannelTargets
        .map((channel) => ({
          channel,
          score: scoreChannelMatch(group.channel, channel),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score || a.channel.localeCompare(b.channel))
        .slice(0, 6);

      const exactAuto = normalizedChannelTargets.find(
        (channel) => normalizeChannelValue(channel) === normalizeChannelValue(group.channel),
      );
      const bestCandidate = candidates[0];
      const autoBinding = exactAuto ?? (bestCandidate && bestCandidate.score >= 0.9 ? bestCandidate.channel : null);
      const boundChannel =
        normalizedExplicit
          ? normalizedChannelTargets.find((channel) => normalizeChannelValue(channel) === normalizedExplicit) ?? explicitBinding
          : autoBinding;

      const status: LeadsChannelReview["status"] = !boundPlatform
        ? "unresolved"
        : boundChannel
          ? "canonical_bound"
          : "platform_only";

      return {
        binding_key: bindingKey,
        input_platform: group.input_platform,
        bound_platform: boundPlatform,
        input_channel: group.channel,
        normalized_channel: normalizeChannelValue(group.channel),
        row_count: group.row_count,
        leads: group.leads,
        status,
        bound_channel: status === "canonical_bound" ? boundChannel : null,
        available_targets: normalizedChannelTargets,
        candidates,
      };
    });

  const channelBindingSummary = {
    canonical_bound: channelReview.filter((item) => item.status === "canonical_bound").length,
    platform_only: channelReview.filter((item) => item.status === "platform_only").length,
    unresolved: channelReview.filter((item) => item.status === "unresolved").length,
  };

  if (selectedPlatforms.length && !normalizedChannelTargets.length) {
    issues.push({ severity: "info", code: "NO_TARGET_CHANNELS", message: "No dashboard channels are currently available for leads channel binding." });
  } else if (channelBindingSummary.platform_only > 0) {
    issues.push({ severity: "info", code: "PLATFORM_ONLY_CHANNELS", message: `${channelBindingSummary.platform_only} lead channel groups are platform-bound but not channel-bound yet.` });
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  const hasWarns = issues.some((issue) => issue.severity === "warn");

  return {
    status: hasErrors ? "error" : hasWarns ? "warn" : "ok",
    sheet_url_input: parsed.input_url,
    sheet_url_fetch: parsed.fetch_url,
    rows_total: parsed.raw_rows,
    rows_parsed: parsed.rows.length,
    dated_rows: datedRows,
    channels: new Set(parsed.rows.map((row) => row.channel).filter(Boolean)).size,
    platforms_detected: platformReview.map((item) => item.normalized_platform),
    selected_platforms: selectedPlatforms,
    binding_summary: {
      canonical_bound: boundCount,
      unresolved: unresolvedCount,
      ignored: ignoredCount,
    },
    platform_review: platformReview,
    channel_binding_summary: channelBindingSummary,
    channel_review: channelReview,
    issues,
    sample_rows: parsed.rows.slice(0, 5),
  };
}

export async function applyLeadsReview(
  sourceConfig: LeadsSourceConfig,
  selectedPlatforms: string[],
  selectedChannels: string[],
  platformBindings: LeadsPlatformBindingMap,
  channelBindings: LeadsChannelBindingMap,
): Promise<LeadsConfirmResult> {
  const existingBindings = extractReviewBindings(sourceConfig);
  const existingChannelBindings = extractReviewChannelBindings(sourceConfig);
  const normalizedBindings = Object.fromEntries(
    Object.entries({
      ...existingBindings,
      ...platformBindings,
    }).map(([key, value]) => [normalizeManualPlatformId(key), String(value ?? "").trim()]),
  );
  const normalizedChannelBindings = Object.fromEntries(
    Object.entries({
      ...existingChannelBindings,
      ...channelBindings,
    }).map(([key, value]) => [key, String(value ?? "").trim()]),
  );

  const nextSourceConfig: LeadsSourceConfig = {
    ...sourceConfig,
    review: {
      ...(sourceConfig.review && typeof sourceConfig.review === "object"
        ? (sourceConfig.review as Record<string, unknown>)
        : {}),
      platform_bindings: normalizedBindings,
      channel_bindings: normalizedChannelBindings,
    },
  };

  const analysis = await analyzeLeadSourceConfig(nextSourceConfig, selectedPlatforms, selectedChannels);
  const reviewedSourceConfig: Record<string, unknown> = {
    ...(sourceConfig as Record<string, unknown>),
    inline_rows: (await fetchLeadsFromSourceConfig(nextSourceConfig)).rows.map((row) => ({ ...row })),
    upload_file: undefined,
    review: {
      review_version: 1,
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      sheet_url_input: analysis.sheet_url_input,
      sheet_url_fetch: analysis.sheet_url_fetch,
      rows_total: analysis.rows_total,
      rows_parsed: analysis.rows_parsed,
      dated_rows: analysis.dated_rows,
      channels: analysis.channels,
      platforms_detected: analysis.platforms_detected,
      selected_platforms: analysis.selected_platforms,
      platform_bindings: normalizedBindings,
      binding_summary: analysis.binding_summary,
      selected_channels: selectedChannels,
      channel_bindings: normalizedChannelBindings,
      channel_binding_summary: analysis.channel_binding_summary,
      issues: analysis.issues,
    } satisfies LeadsReviewedConfig,
  };

  return {
    analysis,
    reviewed_source_config: reviewedSourceConfig,
  };
}

export async function aggregateConfirmedLeadsByPlatform(
  sourceConfig: LeadsSourceConfig,
  allowedPlatformIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<LeadsPlatformConversions> {
  if (reviewStatus(sourceConfig) !== "confirmed") {
    return {};
  }

  const allowed = new Set(allowedPlatformIds.map((item) => normalizeManualPlatformId(item)).filter(Boolean));
  if (!allowed.size) {
    return {};
  }

  const rows = (await fetchLeadsFromSourceConfig(sourceConfig)).rows;
  const bindings = extractReviewBindings(sourceConfig);
  const totals: LeadsPlatformConversions = {};

  for (const row of rows) {
    if (!row.date || row.date < dateFrom || row.date > dateTo) {
      continue;
    }

    const explicit = String(bindings[row.platform] ?? "").trim();
    if (explicit === "__ignore__") {
      continue;
    }

    const boundPlatform = explicit
      ? normalizeManualPlatformId(explicit)
      : normalizeManualPlatformId(row.platform);

    if (!boundPlatform || !allowed.has(boundPlatform)) {
      continue;
    }

    totals[boundPlatform] = (totals[boundPlatform] ?? 0) + Math.max(0, row.leads);
  }

  return totals;
}

export async function aggregateConfirmedLeadsByCanonicalChannel(
  sourceConfig: LeadsSourceConfig,
  allowedPlatformIds: string[],
  allowedChannels: string[],
  dateFrom: string,
  dateTo: string,
): Promise<ConfirmedLeadChannelRow[]> {
  if (reviewStatus(sourceConfig) !== "confirmed") {
    return [];
  }

  const allowedPlatforms = Array.from(
    new Set(allowedPlatformIds.map((item) => normalizeManualPlatformId(item)).filter(Boolean)),
  );
  const allowedPlatformSet = new Set(allowedPlatforms);
  const normalizedChannelMap = new Map(
    allowedChannels
      .map((channel) => String(channel).trim())
      .filter(Boolean)
      .map((channel) => [normalizeChannelValue(channel), channel] as const),
  );

  if (!allowedPlatformSet.size || normalizedChannelMap.size === 0) {
    return [];
  }

  const analysis = await analyzeLeadSourceConfig(sourceConfig, allowedPlatforms, Array.from(normalizedChannelMap.values()));
  const canonicalBindings = new Map(
    analysis.channel_review
      .filter((item) => item.status === "canonical_bound" && item.bound_platform && item.bound_channel)
      .map((item) => [
        item.binding_key,
        {
          bound_platform: normalizeManualPlatformId(item.bound_platform!),
          bound_channel: item.bound_channel!,
        },
      ] as const),
  );

  if (!canonicalBindings.size) {
    return [];
  }

  const rows = (await fetchLeadsFromSourceConfig(sourceConfig)).rows;
  const aggregated = new Map<string, ConfirmedLeadChannelRow>();

  for (const row of rows) {
    if (!row.date || row.date < dateFrom || row.date > dateTo) {
      continue;
    }

    const binding = canonicalBindings.get(makeChannelBindingKey(row.platform, row.channel));
    if (!binding) {
      continue;
    }

    if (!allowedPlatformSet.has(binding.bound_platform)) {
      continue;
    }

    const normalizedChannel = normalizeChannelValue(binding.bound_channel);
    const runtimeChannel = normalizedChannelMap.get(normalizedChannel);
    if (!runtimeChannel) {
      continue;
    }

    const key = `${row.date}|${binding.bound_platform}|${runtimeChannel}`;
    if (!aggregated.has(key)) {
      aggregated.set(key, {
        date: row.date,
        bound_platform: binding.bound_platform,
        bound_channel: runtimeChannel,
        leads: 0,
      });
    }
    aggregated.get(key)!.leads += Math.max(0, row.leads);
  }

  return Array.from(aggregated.values());
}
