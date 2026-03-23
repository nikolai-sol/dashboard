import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { loadDashboardData } from "@/lib/dashboard-data-loader";
import { getDashboardI18n } from "@/lib/dashboard-i18n";
import { PLATFORM_COLORS } from "@/lib/platform-colors";
import { resolvePlatformIdFromSourceKey } from "@/lib/source-mapping";
import type {
  DashboardData,
  PlanVsFactItem,
  PlatformStats,
} from "@/lib/types";

type KpiExportRow = {
  metric: string;
  value: number;
  previous: number;
  change_pct: number | null;
  format: "number" | "percent" | "currency" | "decimal";
};

type PlatformPlanAggregate = {
  id: string;
  label: string;
  impressions_plan: number;
  impressions_fact: number;
  clicks_plan: number;
  clicks_fact: number;
  views_plan: number;
  views_fact: number;
  conversions_plan: number;
  conversions_fact: number;
  spend_plan: number;
  spend_fact: number;
};

type DailyExportMode = "platform" | "channel";
type DailyExportRow = {
  date: string;
  primary: string;
  secondary?: string;
  impressions: number;
  clicks: number;
  spend: number;
  views: number;
  conversions: number;
};

const SPEND_RELATED_METRICS = new Set(["spend", "cpm", "cpc", "cpv", "cpa", "roas"]);
const SHEET_NAME_LIMIT = 31;
const HEADER_FILL = "FF1E293B";
const HEADER_TEXT = "FFFFFFFF";
const ROW_ALT_FILL = "FFF8FAFC";
const TOTAL_FILL = "FFF1F5F9";
const GREEN_FILL = "FFDCFCE7";
const YELLOW_FILL = "FFFEF9C3";
const RED_FILL = "FFFEE2E2";
const BORDER_COLOR = "FFE2E8F0";

function filenameSafe(value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ascii || "dashboard";
}

function truncateSheetName(name: string, used: Set<string>): string {
  const clean = name.replace(/[\\/*?:\[\]]/g, " ").trim() || "Sheet";
  const base = clean.slice(0, SHEET_NAME_LIMIT);
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    const suffix = ` ${index}`;
    candidate = `${base.slice(0, SHEET_NAME_LIMIT - suffix.length)}${suffix}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function autoFit(worksheet: ExcelJS.Worksheet, min = 12, max = 36) {
  worksheet.columns.forEach((column) => {
    const eachCell = column?.eachCell?.bind(column);
    if (!eachCell) return;
    let longest = min;
    eachCell({ includeEmpty: true }, (cell) => {
      const raw = cell.value;
      let text = "";
      if (raw === null || raw === undefined) {
        text = "";
      } else if (typeof raw === "object" && "richText" in raw && Array.isArray(raw.richText)) {
        text = raw.richText.map((part) => part.text).join("");
      } else {
        text = String(raw);
      }
      longest = Math.max(longest, Math.min(max, text.length + 2));
    });
    column.width = longest;
  });
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = {
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
    };
  });
}

function styleBodyRow(row: ExcelJS.Row, alternate = false) {
  row.eachCell((cell) => {
    cell.border = {
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
    };
    if (alternate) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROW_ALT_FILL } };
    }
  });
}

function styleTotalRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
    };
  });
}

function applyCompletionFill(cell: ExcelJS.Cell, value: number | null) {
  if (value === null || !Number.isFinite(value)) return;
  const fill = value >= 90 ? GREEN_FILL : value >= 70 ? YELLOW_FILL : RED_FILL;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
}

function currencyFormat(currency: string): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "RUB" ? "₽" : currency;
  return `${symbol}#,##0.00`;
}

function compactMetricLabel(metric: string, labels: Record<string, string>): string {
  return labels[metric] ?? metric.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function addWorksheetTitle(
  worksheet: ExcelJS.Worksheet,
  title: string,
  subtitle?: string,
  mergeTo = 8,
) {
  worksheet.mergeCells(1, 1, 1, mergeTo);
  const titleCell = worksheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14 };

  if (subtitle) {
    worksheet.mergeCells(2, 1, 2, mergeTo);
    const subtitleCell = worksheet.getCell(2, 1);
    subtitleCell.value = subtitle;
    subtitleCell.font = { color: { argb: "FF64748B" }, size: 10 };
  }
}

function totalsFromPlatforms(rows: PlatformStats[]) {
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const spend = rows.reduce((sum, row) => sum + row.spend, 0);
  const conversions = rows.reduce((sum, row) => sum + row.conversions, 0);
  const views = rows.reduce((sum, row) => sum + row.views, 0);
  const reach = rows.reduce((sum, row) => sum + row.reach, 0);
  return {
    impressions,
    clicks,
    spend,
    conversions,
    views,
    reach,
    ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
    cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
    cpc: clicks > 0 ? spend / clicks : 0,
    cpv: views > 0 ? spend / views : 0,
    cpa: conversions > 0 ? spend / conversions : 0,
    frequency: reach > 0 ? impressions / reach : 0,
  };
}

function buildKpiRows(data: DashboardData, previousPlatforms: PlatformStats[]): KpiExportRow[] {
  const i18n = getDashboardI18n(data.dashboard.language);
  const current = totalsFromPlatforms(data.platforms);
  const previous = totalsFromPlatforms(previousPlatforms);
  const showSpend = data.dashboard.show_spend;
  const config = (data.kpi_config ?? []).filter((metric) => showSpend || !SPEND_RELATED_METRICS.has(metric));
  const visibleBase = (config.length ? config : ["impressions", "clicks", "ctr", "cpm", "spend"]).slice(0, 5);

  const metricMap: Record<string, Omit<KpiExportRow, "metric">> = {
    impressions: { value: current.impressions, previous: previous.impressions, change_pct: previous.impressions ? ((current.impressions - previous.impressions) / previous.impressions) * 100 : null, format: "number" },
    clicks: { value: current.clicks, previous: previous.clicks, change_pct: previous.clicks ? ((current.clicks - previous.clicks) / previous.clicks) * 100 : null, format: "number" },
    ctr: { value: current.ctr, previous: previous.ctr, change_pct: previous.ctr ? ((current.ctr - previous.ctr) / previous.ctr) * 100 : null, format: "percent" },
    cpm: { value: current.cpm, previous: previous.cpm, change_pct: previous.cpm ? ((current.cpm - previous.cpm) / previous.cpm) * 100 : null, format: "currency" },
    cpc: { value: current.cpc, previous: previous.cpc, change_pct: previous.cpc ? ((current.cpc - previous.cpc) / previous.cpc) * 100 : null, format: "currency" },
    spend: { value: current.spend, previous: previous.spend, change_pct: previous.spend ? ((current.spend - previous.spend) / previous.spend) * 100 : null, format: "currency" },
    views: { value: current.views, previous: previous.views, change_pct: previous.views ? ((current.views - previous.views) / previous.views) * 100 : null, format: "number" },
    cpv: { value: current.cpv, previous: previous.cpv, change_pct: previous.cpv ? ((current.cpv - previous.cpv) / previous.cpv) * 100 : null, format: "currency" },
    conversions: { value: current.conversions, previous: previous.conversions, change_pct: previous.conversions ? ((current.conversions - previous.conversions) / previous.conversions) * 100 : null, format: "number" },
    cpa: { value: current.cpa, previous: previous.cpa, change_pct: previous.cpa ? ((current.cpa - previous.cpa) / previous.cpa) * 100 : null, format: "currency" },
    reach: { value: current.reach, previous: previous.reach, change_pct: previous.reach ? ((current.reach - previous.reach) / previous.reach) * 100 : null, format: "number" },
    frequency: { value: current.frequency, previous: previous.frequency, change_pct: previous.frequency ? ((current.frequency - previous.frequency) / previous.frequency) * 100 : null, format: "decimal" },
  };

  const rows: KpiExportRow[] = visibleBase.map((metric) => ({
    metric: compactMetricLabel(metric, i18n.metrics),
    ...(metricMap[metric] ?? metricMap.impressions),
  }));

  for (const card of data.custom_kpi_cards ?? []) {
    const source = metricMap[card.trend_source] ?? metricMap.impressions;
    rows.push({
      metric: card.title,
      value: card.value,
      previous: card.value,
      change_pct: source.change_pct,
      format: source.format,
    });
  }

  return rows;
}

function aggregatePlanByPlatform(rows: PlanVsFactItem[]): PlatformPlanAggregate[] {
  const grouped = new Map<string, PlatformPlanAggregate>();

  for (const row of rows) {
    const platformIds = row.platforms
      .map((platform) => resolvePlatformIdFromSourceKey(platform.source_key))
      .filter(Boolean);
    if (!platformIds.length) continue;

    const split = platformIds.length;
    for (const platformId of platformIds) {
      if (!grouped.has(platformId)) {
        grouped.set(platformId, {
          id: platformId,
          label: PLATFORM_COLORS[platformId]?.label ?? platformId,
          impressions_plan: 0,
          impressions_fact: 0,
          clicks_plan: 0,
          clicks_fact: 0,
          views_plan: 0,
          views_fact: 0,
          conversions_plan: 0,
          conversions_fact: 0,
          spend_plan: 0,
          spend_fact: 0,
        });
      }
      const item = grouped.get(platformId)!;
      item.impressions_plan += row.impressions_plan / split;
      item.impressions_fact += row.impressions_fact / split;
      item.clicks_plan += row.clicks_plan / split;
      item.clicks_fact += row.clicks_fact / split;
      item.views_plan += row.views_plan / split;
      item.views_fact += row.views_fact / split;
      item.conversions_plan += row.conversions_plan / split;
      item.conversions_fact += row.conversions_fact / split;
      item.spend_plan += row.budget_plan / split;
      item.spend_fact += row.budget_fact / split;
    }
  }

  return Array.from(grouped.values()).sort((a, b) => b.spend_fact - a.spend_fact || b.clicks_fact - a.clicks_fact);
}

function worksheetHasSection(data: DashboardData, sectionId: DashboardData["dashboard"]["section_order"][number]) {
  return data.dashboard.section_order.includes(sectionId);
}

function setNumFmt(cell: ExcelJS.Cell, format: string) {
  cell.numFmt = format;
}

function percentFromPlanFact(fact: number, plan: number): number | null {
  return plan > 0 ? Number((((fact / plan) * 100)).toFixed(1)) : null;
}

function buildChannelDailyMap(channelTimeseries: DashboardData["channel_timeseries"]) {
  const grouped = new Map<string, NonNullable<DashboardData["channel_timeseries"]>>();
  for (const row of channelTimeseries ?? []) {
    if (!grouped.has(row.channel)) {
      grouped.set(row.channel, []);
    }
    grouped.get(row.channel)!.push(row);
  }
  for (const rows of grouped.values()) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
  }
  return grouped;
}

function buildDailyExport(data: DashboardData):
  | { mode: DailyExportMode; rows: DailyExportRow[] }
  | null {
  if (!worksheetHasSection(data, "trend_chart")) {
    return null;
  }

  const hasPlatformSection =
    worksheetHasSection(data, "platform_table") ||
    worksheetHasSection(data, "platform_plan_fact") ||
    worksheetHasSection(data, "spend_section");
  const hasChannelSection =
    worksheetHasSection(data, "channel_table") || worksheetHasSection(data, "plan_vs_fact");

  if (
    data.dashboard.filter_scope === "channel" &&
    hasChannelSection &&
    !hasPlatformSection &&
    (data.channel_timeseries?.length ?? 0) > 0
  ) {
    return {
      mode: "channel",
      rows: [...(data.channel_timeseries ?? [])]
        .sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel))
        .map((row) => ({
          date: row.date,
          primary: row.channel,
          secondary: row.instrument,
          impressions: row.impressions,
          clicks: row.clicks,
          spend: row.spend,
          views: row.views,
          conversions: row.conversions,
        })),
    };
  }

  if (data.timeseries.length > 0) {
    return {
      mode: "platform",
      rows: [...data.timeseries]
        .sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform))
        .map((row) => ({
          date: row.date,
          primary: PLATFORM_COLORS[row.platform]?.label ?? row.platform,
          impressions: row.impressions,
          clicks: row.clicks,
          spend: row.spend,
          views: row.views ?? 0,
          conversions: row.conversions ?? 0,
        })),
    };
  }

  if ((data.channel_timeseries?.length ?? 0) > 0) {
    return {
      mode: "channel",
      rows: [...(data.channel_timeseries ?? [])]
        .sort((a, b) => a.date.localeCompare(b.date) || a.channel.localeCompare(b.channel))
        .map((row) => ({
          date: row.date,
          primary: row.channel,
          secondary: row.instrument,
          impressions: row.impressions,
          clicks: row.clicks,
          spend: row.spend,
          views: row.views,
          conversions: row.conversions,
        })),
    };
  }

  return null;
}

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const { id } = await Promise.resolve(context.params);
    const { data, previous_platforms, leads_rows } = await loadDashboardData(request, id);
    const i18n = getDashboardI18n(data.dashboard.language);
    const currency = data.dashboard.currency || "EUR";
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SolGoood Dashboard";
    workbook.created = new Date();
    workbook.properties.date1904 = true;

    const usedSheetNames = new Set<string>();
    const subtitle = `Period: ${data.dashboard.period.from} — ${data.dashboard.period.to}`;

    const showSummaryKpi = worksheetHasSection(data, "kpi_grid");
    const showSummaryPlatforms = worksheetHasSection(data, "platform_table");
    const showSummarySheet = showSummaryKpi || showSummaryPlatforms;
    const showChannelSheet = worksheetHasSection(data, "plan_vs_fact") || worksheetHasSection(data, "channel_table");
    const showPlatformPlanSheet = worksheetHasSection(data, "platform_plan_fact");
    const showDailySheet = worksheetHasSection(data, "trend_chart");
    const showCustomTableSheets = (data.custom_tables?.length ?? 0) > 0;
    const showLeadsSheet = false;
    const showComparisonSheet = Boolean(data.comparison);

    if (showSummarySheet) {
      const summary = workbook.addWorksheet(truncateSheetName("Summary", usedSheetNames), {
        views: [{ state: "frozen", ySplit: 4 }],
      });
      addWorksheetTitle(summary, `${data.dashboard.client_name} — ${data.dashboard.dashboard_name}`, subtitle, 8);
      let summaryRow = 4;

      if (showSummaryKpi) {
        summary.getCell(summaryRow, 1).value = "KPI";
        summary.getCell(summaryRow, 1).font = { bold: true, size: 12 };
        summaryRow += 1;
        const header = summary.getRow(summaryRow);
        header.values = ["Metric", "Value", "Previous", "Change %"];
        styleHeaderRow(header);
        summaryRow += 1;

        for (const row of buildKpiRows(data, previous_platforms)) {
          const excelRow = summary.getRow(summaryRow);
          excelRow.values = [row.metric, row.value, row.previous, row.change_pct === null ? "" : row.change_pct / 100];
          styleBodyRow(excelRow, summaryRow % 2 === 0);
          if (row.format === "currency") {
            setNumFmt(excelRow.getCell(2), currencyFormat(currency));
            setNumFmt(excelRow.getCell(3), currencyFormat(currency));
          } else if (row.format === "percent") {
            setNumFmt(excelRow.getCell(2), "0.00%");
            setNumFmt(excelRow.getCell(3), "0.00%");
          } else if (row.format === "decimal") {
            setNumFmt(excelRow.getCell(2), "0.00");
            setNumFmt(excelRow.getCell(3), "0.00");
          } else {
            setNumFmt(excelRow.getCell(2), "#,##0");
            setNumFmt(excelRow.getCell(3), "#,##0");
          }
          setNumFmt(excelRow.getCell(4), "0.00%");
          summaryRow += 1;
        }
        summaryRow += 1;
      }

      if (showSummaryPlatforms) {
        summary.getCell(summaryRow, 1).value = i18n.sections.platformPerformance;
        summary.getCell(summaryRow, 1).font = { bold: true, size: 12 };
        summaryRow += 1;
        const headers = ["Platform", "Impressions", "Clicks", "CTR", ...(data.dashboard.show_spend ? ["CPM", "Spend"] : []), "Views", "Conversions"];
        const header = summary.getRow(summaryRow);
        header.values = headers;
        styleHeaderRow(header);
        summaryRow += 1;

        for (const platform of data.platforms) {
          const values = [
            platform.name,
            platform.impressions,
            platform.clicks,
            platform.ctr / 100,
            ...(data.dashboard.show_spend ? [platform.cpm, platform.spend] : []),
            platform.views,
            platform.conversions,
          ];
          const row = summary.getRow(summaryRow);
          row.values = values;
          styleBodyRow(row, summaryRow % 2 === 0);
          setNumFmt(row.getCell(2), "#,##0");
          setNumFmt(row.getCell(3), "#,##0");
          setNumFmt(row.getCell(4), "0.00%");
          if (data.dashboard.show_spend) {
            setNumFmt(row.getCell(5), currencyFormat(currency));
            setNumFmt(row.getCell(6), currencyFormat(currency));
            setNumFmt(row.getCell(7), "#,##0");
            setNumFmt(row.getCell(8), "#,##0");
          } else {
            setNumFmt(row.getCell(5), "#,##0");
            setNumFmt(row.getCell(6), "#,##0");
          }
          summaryRow += 1;
        }

        const totals = totalsFromPlatforms(data.platforms);
        const totalRow = summary.getRow(summaryRow);
        totalRow.values = [
          i18n.common.total,
          totals.impressions,
          totals.clicks,
          totals.ctr / 100,
          ...(data.dashboard.show_spend ? [totals.cpm, totals.spend] : []),
          totals.views,
          totals.conversions,
        ];
        styleTotalRow(totalRow);
        setNumFmt(totalRow.getCell(2), "#,##0");
        setNumFmt(totalRow.getCell(3), "#,##0");
        setNumFmt(totalRow.getCell(4), "0.00%");
        if (data.dashboard.show_spend) {
          setNumFmt(totalRow.getCell(5), currencyFormat(currency));
          setNumFmt(totalRow.getCell(6), currencyFormat(currency));
          setNumFmt(totalRow.getCell(7), "#,##0");
          setNumFmt(totalRow.getCell(8), "#,##0");
        } else {
          setNumFmt(totalRow.getCell(5), "#,##0");
          setNumFmt(totalRow.getCell(6), "#,##0");
        }
      }

      autoFit(summary);
    }

    if (showChannelSheet) {
      const ws = workbook.addWorksheet(truncateSheetName("Channel Performance", usedSheetNames), {
        views: [{ state: "frozen", ySplit: 4 }],
      });
      ws.properties.outlineLevelRow = 1;
      addWorksheetTitle(ws, i18n.sections.channelPerformancePlanFact, subtitle, 15);
      const headerRow = ws.getRow(4);
      headerRow.values = [
        "Channel",
        "Instrument",
        "Buy Type",
        "Impressions Plan",
        "Impressions Fact",
        "Impr %",
        "Clicks Plan",
        "Clicks Fact",
        "Clicks %",
        "Views Plan",
        "Views Fact",
        "Views %",
        ...(data.dashboard.show_spend ? ["Budget Plan", "Budget Fact", "Budget %"] : []),
        "Conversions Plan",
        "Conversions Fact",
        "Conv %",
      ];
      styleHeaderRow(headerRow);
      let rowIndex = 5;
      const dailyRowsByChannel = buildChannelDailyMap(data.channel_timeseries);
      for (const row of data.channel_performance ?? []) {
        const spendMetric = row.metrics.spend;
        const excelRow = ws.getRow(rowIndex);
        excelRow.values = [
          row.channel,
          row.instrument,
          row.buy_type,
          row.metrics.impressions?.plan ?? 0,
          row.metrics.impressions?.fact ?? 0,
          (row.metrics.impressions?.completion_pct ?? 0) / 100,
          row.metrics.clicks?.plan ?? 0,
          row.metrics.clicks?.fact ?? 0,
          (row.metrics.clicks?.completion_pct ?? 0) / 100,
          row.metrics.views?.plan ?? 0,
          row.metrics.views?.fact ?? 0,
          (row.metrics.views?.completion_pct ?? 0) / 100,
          ...(data.dashboard.show_spend ? [spendMetric?.plan ?? 0, spendMetric?.fact ?? 0, ((spendMetric?.completion_pct ?? 0) / 100)] : []),
          row.metrics.conversions?.plan ?? 0,
          row.metrics.conversions?.fact ?? 0,
          (row.metrics.conversions?.completion_pct ?? 0) / 100,
        ];
        styleBodyRow(excelRow, rowIndex % 2 === 0);
        for (const col of [6, 9, 12, ...(data.dashboard.show_spend ? [15] : []), data.dashboard.show_spend ? 18 : 15]) {
          setNumFmt(excelRow.getCell(col), "0.0%");
          applyCompletionFill(excelRow.getCell(col), typeof excelRow.getCell(col).value === "number" ? Number(excelRow.getCell(col).value) * 100 : null);
        }
        if (data.dashboard.show_spend) {
          setNumFmt(excelRow.getCell(13), currencyFormat(currency));
          setNumFmt(excelRow.getCell(14), currencyFormat(currency));
        }
        rowIndex += 1;

        const dailyRows = dailyRowsByChannel.get(row.channel) ?? [];
        for (const daily of dailyRows) {
          const dailyRow = ws.getRow(rowIndex);
          dailyRow.values = [
            `${daily.date}`,
            "",
            "",
            "",
            daily.impressions,
            "",
            "",
            daily.clicks,
            "",
            "",
            daily.views,
            "",
            ...(data.dashboard.show_spend ? ["", daily.spend, ""] : []),
            "",
            daily.conversions,
            "",
          ];
          dailyRow.outlineLevel = 1;
          styleBodyRow(dailyRow, true);
          dailyRow.getCell(1).alignment = { indent: 1, horizontal: "left", vertical: "middle" };
          dailyRow.getCell(1).font = { italic: true, color: { argb: "FF64748B" } };
          setNumFmt(dailyRow.getCell(5), "#,##0");
          setNumFmt(dailyRow.getCell(8), "#,##0");
          setNumFmt(dailyRow.getCell(11), "#,##0");
          if (data.dashboard.show_spend) {
            setNumFmt(dailyRow.getCell(14), currencyFormat(currency));
            setNumFmt(dailyRow.getCell(17), "#,##0");
          } else {
            setNumFmt(dailyRow.getCell(14), "#,##0");
          }
          rowIndex += 1;
        }
      }

      const totals = (data.channel_performance ?? []).reduce(
        (acc, row) => {
          acc.impressionsPlan += row.metrics.impressions?.plan ?? 0;
          acc.impressionsFact += row.metrics.impressions?.fact ?? 0;
          acc.clicksPlan += row.metrics.clicks?.plan ?? 0;
          acc.clicksFact += row.metrics.clicks?.fact ?? 0;
          acc.viewsPlan += row.metrics.views?.plan ?? 0;
          acc.viewsFact += row.metrics.views?.fact ?? 0;
          acc.spendPlan += row.metrics.spend?.plan ?? 0;
          acc.spendFact += row.metrics.spend?.fact ?? 0;
          acc.conversionsPlan += row.metrics.conversions?.plan ?? 0;
          acc.conversionsFact += row.metrics.conversions?.fact ?? 0;
          return acc;
        },
        { impressionsPlan: 0, impressionsFact: 0, clicksPlan: 0, clicksFact: 0, viewsPlan: 0, viewsFact: 0, spendPlan: 0, spendFact: 0, conversionsPlan: 0, conversionsFact: 0 },
      );
      const totalRow = ws.getRow(rowIndex);
      totalRow.values = [
        i18n.common.total,
        "",
        "",
        totals.impressionsPlan,
        totals.impressionsFact,
        (percentFromPlanFact(totals.impressionsFact, totals.impressionsPlan) ?? 0) / 100,
        totals.clicksPlan,
        totals.clicksFact,
        (percentFromPlanFact(totals.clicksFact, totals.clicksPlan) ?? 0) / 100,
        totals.viewsPlan,
        totals.viewsFact,
        (percentFromPlanFact(totals.viewsFact, totals.viewsPlan) ?? 0) / 100,
        ...(data.dashboard.show_spend ? [totals.spendPlan, totals.spendFact, (percentFromPlanFact(totals.spendFact, totals.spendPlan) ?? 0) / 100] : []),
        totals.conversionsPlan,
        totals.conversionsFact,
        (percentFromPlanFact(totals.conversionsFact, totals.conversionsPlan) ?? 0) / 100,
      ];
      styleTotalRow(totalRow);
      autoFit(ws);
    }

    if (showPlatformPlanSheet) {
      const ws = workbook.addWorksheet(truncateSheetName("Platform Plan Fact", usedSheetNames), {
        views: [{ state: "frozen", ySplit: 4 }],
      });
      addWorksheetTitle(ws, i18n.sections.platformPerformancePlanFact, subtitle, 15);
      const headerRow = ws.getRow(4);
      headerRow.values = [
        "Platform",
        "Impressions Plan",
        "Impressions Fact",
        "Impr %",
        "Clicks Plan",
        "Clicks Fact",
        "Clicks %",
        "Views Plan",
        "Views Fact",
        "Views %",
        ...(data.dashboard.show_spend ? ["Budget Plan", "Budget Fact", "Budget %"] : []),
        "Conversions Plan",
        "Conversions Fact",
        "Conv %",
      ];
      styleHeaderRow(headerRow);
      const rows = aggregatePlanByPlatform(data.plan_vs_fact);
      let rowIndex = 5;
      for (const row of rows) {
        const excelRow = ws.getRow(rowIndex);
        excelRow.values = [
          row.label,
          row.impressions_plan,
          row.impressions_fact,
          (percentFromPlanFact(row.impressions_fact, row.impressions_plan) ?? 0) / 100,
          row.clicks_plan,
          row.clicks_fact,
          (percentFromPlanFact(row.clicks_fact, row.clicks_plan) ?? 0) / 100,
          row.views_plan,
          row.views_fact,
          (percentFromPlanFact(row.views_fact, row.views_plan) ?? 0) / 100,
          ...(data.dashboard.show_spend ? [row.spend_plan, row.spend_fact, (percentFromPlanFact(row.spend_fact, row.spend_plan) ?? 0) / 100] : []),
          row.conversions_plan,
          row.conversions_fact,
          (percentFromPlanFact(row.conversions_fact, row.conversions_plan) ?? 0) / 100,
        ];
        styleBodyRow(excelRow, rowIndex % 2 === 0);
        if (data.dashboard.show_spend) {
          setNumFmt(excelRow.getCell(11), currencyFormat(currency));
          setNumFmt(excelRow.getCell(12), currencyFormat(currency));
        }
        rowIndex += 1;
      }
      autoFit(ws);
    }

    const dailyExport = showDailySheet ? buildDailyExport(data) : null;
    if (dailyExport) {
      const ws = workbook.addWorksheet(truncateSheetName("Daily Data", usedSheetNames), {
        views: [{ state: "frozen", ySplit: 4 }],
      });
      addWorksheetTitle(ws, i18n.sections.trendByDay, subtitle, 8);
      const headerRow = ws.getRow(4);
      headerRow.values =
        dailyExport.mode === "channel"
          ? ["Date", "Channel", "Instrument", "Impressions", "Clicks", ...(data.dashboard.show_spend ? ["Spend"] : []), "Views", "Conversions"]
          : ["Date", "Platform", "Impressions", "Clicks", ...(data.dashboard.show_spend ? ["Spend"] : []), "Views", "Conversions"];
      styleHeaderRow(headerRow);
      let rowIndex = 5;
      for (const row of dailyExport.rows) {
        const excelRow = ws.getRow(rowIndex);
        const prefix =
          dailyExport.mode === "channel"
            ? [row.date, row.primary, row.secondary ?? ""]
            : [row.date, row.primary];
        excelRow.values = [...prefix, row.impressions, row.clicks, ...(data.dashboard.show_spend ? [row.spend] : []), row.views, row.conversions];
        styleBodyRow(excelRow, rowIndex % 2 === 0);
        excelRow.getCell(1).numFmt = "yyyy-mm-dd";
        if (data.dashboard.show_spend) {
          setNumFmt(
            excelRow.getCell(dailyExport.mode === "channel" ? 6 : 5),
            currencyFormat(currency),
          );
        }
        rowIndex += 1;
      }
      autoFit(ws);
    }

    if (showComparisonSheet && data.comparison) {
      const ws = workbook.addWorksheet(truncateSheetName("Comparison", usedSheetNames), {
        views: [{ state: "frozen", ySplit: 4 }],
      });
      const comparisonSubtitle = `${data.comparison.period_a.label} vs ${data.comparison.period_b.label}`;
      addWorksheetTitle(ws, i18n.sections.comparison, comparisonSubtitle, 10);

      let rowIndex = 4;
      const summaryHeader = ws.getRow(rowIndex);
      summaryHeader.values = ["Metric", "Period A", "Period B", "Delta", "Delta %"];
      styleHeaderRow(summaryHeader);
      rowIndex += 1;

      const comparisonMetrics = (data.kpi_config?.length ? data.kpi_config : ["impressions", "clicks", "ctr", "spend", "conversions"])
        .filter((metric) => data.dashboard.show_spend || !SPEND_RELATED_METRICS.has(metric))
        .filter((metric) => data.comparison?.kpi_comparison[metric])
        .slice(0, 5);

      for (const metric of comparisonMetrics) {
        const item = data.comparison.kpi_comparison[metric];
        const label = compactMetricLabel(metric, i18n.metrics);
        const row = ws.getRow(rowIndex);
        row.values = [
          label,
          item.value_a,
          item.value_b,
          metric === "ctr" ? item.delta / 100 : item.delta,
          metric === "ctr" ? item.delta_pct / 100 : item.delta_pct / 100,
        ];
        styleBodyRow(row, rowIndex % 2 === 0);
        if (metric === "spend" || metric === "cpm" || metric === "cpc" || metric === "cpv" || metric === "cpa") {
          setNumFmt(row.getCell(2), currencyFormat(currency));
          setNumFmt(row.getCell(3), currencyFormat(currency));
          setNumFmt(row.getCell(4), currencyFormat(currency));
        } else if (metric === "ctr") {
          setNumFmt(row.getCell(2), "0.00%");
          setNumFmt(row.getCell(3), "0.00%");
          row.getCell(4).value = item.delta / 100;
          setNumFmt(row.getCell(4), "0.00%");
        } else {
          setNumFmt(row.getCell(2), "#,##0");
          setNumFmt(row.getCell(3), "#,##0");
          setNumFmt(row.getCell(4), "#,##0");
        }
        setNumFmt(row.getCell(5), "0.00%");
        rowIndex += 1;
      }

      rowIndex += 1;
      const platformHeader = ws.getRow(rowIndex);
      platformHeader.values = ["Platform", "Impressions A", "Impressions B", "Impr Δ%", "Clicks A", "Clicks B", "Clicks Δ%", ...(data.dashboard.show_spend ? ["Spend A", "Spend B", "Spend Δ%"] : []), "CTR A", "CTR B", "CTR Δpp"];
      styleHeaderRow(platformHeader);
      rowIndex += 1;

      for (const rowData of data.comparison.platforms_comparison) {
        const row = ws.getRow(rowIndex);
        row.values = [
          rowData.platform_label,
          rowData.metrics.impressions.value_a,
          rowData.metrics.impressions.value_b,
          rowData.metrics.impressions.delta_pct / 100,
          rowData.metrics.clicks.value_a,
          rowData.metrics.clicks.value_b,
          rowData.metrics.clicks.delta_pct / 100,
          ...(data.dashboard.show_spend ? [rowData.metrics.spend.value_a, rowData.metrics.spend.value_b, rowData.metrics.spend.delta_pct / 100] : []),
          rowData.metrics.ctr.value_a / 100,
          rowData.metrics.ctr.value_b / 100,
          rowData.metrics.ctr.delta / 100,
        ];
        styleBodyRow(row, rowIndex % 2 === 0);
        setNumFmt(row.getCell(2), "#,##0");
        setNumFmt(row.getCell(3), "#,##0");
        setNumFmt(row.getCell(4), "0.00%");
        setNumFmt(row.getCell(5), "#,##0");
        setNumFmt(row.getCell(6), "#,##0");
        setNumFmt(row.getCell(7), "0.00%");
        const ctrStart = data.dashboard.show_spend ? 11 : 8;
        if (data.dashboard.show_spend) {
          setNumFmt(row.getCell(8), currencyFormat(currency));
          setNumFmt(row.getCell(9), currencyFormat(currency));
          setNumFmt(row.getCell(10), "0.00%");
        }
        setNumFmt(row.getCell(ctrStart), "0.00%");
        setNumFmt(row.getCell(ctrStart + 1), "0.00%");
        setNumFmt(row.getCell(ctrStart + 2), "0.00%");
        rowIndex += 1;
      }

      autoFit(ws);
    }

    if (showCustomTableSheets) for (const table of data.custom_tables ?? []) {
      const ws = workbook.addWorksheet(truncateSheetName(table.title, usedSheetNames), {
        views: [{ state: "frozen", ySplit: 2 }],
      });
      addWorksheetTitle(ws, table.title, subtitle, Math.max(6, table.headers.length));
      const headerRow = ws.getRow(4);
      headerRow.values = table.headers;
      styleHeaderRow(headerRow);
      table.rows.forEach((row, index) => {
        const excelRow = ws.getRow(index + 5);
        excelRow.values = row;
        styleBodyRow(excelRow, index % 2 === 0);
      });
      autoFit(ws);
    }

    if (showLeadsSheet && leads_rows?.length) {
      const ws = workbook.addWorksheet(truncateSheetName("Leads", usedSheetNames), {
        views: [{ state: "frozen", ySplit: 4 }],
      });
      addWorksheetTitle(ws, "Leads", subtitle, 8);
      const headerRow = ws.getRow(4);
      headerRow.values = ["Date", "Platform", "Channel", "Source", "Leads", "Qualified", "Revenue", "Notes"];
      styleHeaderRow(headerRow);
      let rowIndex = 5;
      for (const row of [...leads_rows].sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.platform.localeCompare(b.platform))) {
        const excelRow = ws.getRow(rowIndex);
        excelRow.values = [row.date || "", row.platform, row.channel, row.source, row.leads, row.qualified_leads, row.revenue, row.notes];
        styleBodyRow(excelRow, rowIndex % 2 === 0);
        excelRow.getCell(1).numFmt = "yyyy-mm-dd";
        setNumFmt(excelRow.getCell(7), currencyFormat(currency));
        rowIndex += 1;
      }
      autoFit(ws);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const filename = `${filenameSafe(data.dashboard.client_name)}_${data.dashboard.period.from}_${data.dashboard.period.to}.xlsx`;

    return new NextResponse(payload, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Dashboard not found") {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    console.error("Dashboard Excel export error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: message,
      },
      { status: 500 },
    );
  }
}
