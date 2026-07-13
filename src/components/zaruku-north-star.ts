import type {
  ZarukuSeoAiVisibilityAggregateRow,
  ZarukuSeoOpportunityRow,
  ZarukuSeoRunRow,
  ZarukuSeoSovWeeklyRow,
  ZarukuSeoTaskRow,
  ZarukuSeoTaskStatus,
} from "@/lib/types";

const BASELINES = {
  noise: 63.74,
  medicalIntent: 24.81,
  medicalIntentClicks: 72.79,
  aiVisibility: 44,
  approveRate: 4 / 6 * 100,
} as const;

const CLUSTERS = {
  noise: "medical_org_labs_noise",
  medicalIntent: "medical_intent_total",
} as const;

const TASK_LABELS: Record<ZarukuSeoTaskStatus, string> = {
  draft: "Черновик",
  awaiting_medical_review: "Медицинская проверка",
  needs_target_page: "Нужна целевая страница",
  in_progress: "В работе",
  done: "Готово",
  cancelled: "Отменено",
};

export type NorthStarGoal = "up" | "down";

export type NorthStarKpi = {
  key: "noise" | "medicalIntent" | "aiVisibility" | "approveRate";
  label: string;
  value: number | null;
  baseline: number;
  delta: number | null;
  goal: NorthStarGoal;
  period: string | null;
  note?: string;
  tooltip?: string;
  guardValue?: number | null;
  guardBaseline?: number;
  provenance?: string | null;
  series: Array<{ label: string; value: number }>;
};

export type NorthStarKpis = {
  noise: NorthStarKpi;
  medicalIntent: NorthStarKpi;
  aiVisibility: NorthStarKpi;
  approveRate: NorthStarKpi;
};

export type SemanticHealthRow = ZarukuSeoSovWeeklyRow & {
  baseline: number | null;
  baseline_kind: "noise" | "medical" | null;
  isBaselineCluster: boolean;
};

export type WeeklyFocus = {
  seo: string;
  ai: string;
  pipeline: string;
};

function sortText(left: string, right: string) {
  return left.localeCompare(right);
}

function latestValue<T extends { week: string }>(rows: T[], week?: string | null) {
  if (week) return rows.filter((row) => row.week === week);
  const latestWeek = [...new Set(rows.map((row) => row.week))].sort(sortText).at(-1);
  return latestWeek ? rows.filter((row) => row.week === latestWeek) : [];
}

function latestAiRow(rows: ZarukuSeoAiVisibilityAggregateRow[]) {
  return [...rows]
    .sort((left, right) => sortText(left.period, right.period) || Number(left.engine !== "alisa_ai") - Number(right.engine !== "alisa_ai"))
    .at(-1) ?? null;
}

function metricSeries(rows: ZarukuSeoSovWeeklyRow[], cluster: string, valueKey: "impressions_share" | "clicks_share") {
  return rows
    .filter((row) => row.cluster === cluster)
    .sort((left, right) => sortText(left.week, right.week))
    .map((row) => ({ label: row.week, value: row[valueKey] }));
}

function aiSeries(rows: ZarukuSeoAiVisibilityAggregateRow[]) {
  return rows
    .filter((row) => row.engine === "alisa_ai")
    .sort((left, right) => sortText(left.period, right.period))
    .map((row) => ({ label: row.period, value: row.presence_rate }));
}

function approveRateForLatestDecisionWeek(rows: ZarukuSeoOpportunityRow[]) {
  const weeks = [...new Set(rows.map((row) => row.week))].sort(sortText).reverse();
  for (const week of weeks) {
    const decided = rows.filter((row) => row.week === week && (row.decision === "approved" || row.decision === "rejected"));
    if (decided.length > 0) {
      const approved = decided.filter((row) => row.decision === "approved").length;
      return { week, value: approved / decided.length * 100 };
    }
  }
  return { week: null, value: null };
}

function delta(value: number | null, baseline: number) {
  return value == null ? null : value - baseline;
}

export function buildNorthStarKpis({
  sovRows,
  aiRows,
  opportunities,
}: {
  sovRows: ZarukuSeoSovWeeklyRow[];
  aiRows: ZarukuSeoAiVisibilityAggregateRow[];
  opportunities: ZarukuSeoOpportunityRow[];
}): NorthStarKpis {
  const latestSovRows = latestValue(sovRows);
  const noise = latestSovRows.find((row) => row.cluster === CLUSTERS.noise) ?? null;
  const medicalIntent = latestSovRows.find((row) => row.cluster === CLUSTERS.medicalIntent) ?? null;
  const ai = latestAiRow(aiRows);
  const approveRate = approveRateForLatestDecisionWeek(opportunities);

  return {
    noise: {
      key: "noise",
      label: "Шум в показах",
      value: noise?.impressions_share ?? null,
      baseline: BASELINES.noise,
      delta: delta(noise?.impressions_share ?? null, BASELINES.noise),
      goal: "down",
      period: noise?.period_label ?? noise?.week ?? null,
      tooltip: "Доля показов по чужим брендам лабораторий. Доля внутри сайта, не рыночная доля",
      series: metricSeries(sovRows, CLUSTERS.noise, "impressions_share"),
    },
    medicalIntent: {
      key: "medicalIntent",
      label: "Медицинский интент в показах",
      value: medicalIntent?.impressions_share ?? null,
      baseline: BASELINES.medicalIntent,
      delta: delta(medicalIntent?.impressions_share ?? null, BASELINES.medicalIntent),
      goal: "up",
      period: medicalIntent?.period_label ?? medicalIntent?.week ?? null,
      guardValue: medicalIntent?.clicks_share ?? null,
      guardBaseline: BASELINES.medicalIntentClicks,
      series: metricSeries(sovRows, CLUSTERS.medicalIntent, "impressions_share"),
    },
    aiVisibility: {
      key: "aiVisibility",
      label: "Видимость в Алисе AI",
      value: ai?.presence_rate ?? null,
      baseline: BASELINES.aiVisibility,
      delta: delta(ai?.presence_rate ?? null, BASELINES.aiVisibility),
      goal: "up",
      period: ai?.period ?? null,
      note: "SoV, Яндекс Вебмастер, ручной снимок, ежемесячно",
      provenance: ai?.provenance ?? null,
      series: aiSeries(aiRows),
    },
    approveRate: {
      key: "approveRate",
      label: "Доля принятия",
      value: approveRate.value,
      baseline: BASELINES.approveRate,
      delta: delta(approveRate.value, BASELINES.approveRate),
      goal: "up",
      period: approveRate.week,
      series: [],
    },
  };
}

export function buildSemanticHealthRows(rows: ZarukuSeoSovWeeklyRow[], week?: string | null): SemanticHealthRow[] {
  return latestValue(rows, week).map((row) => {
    if (row.cluster === CLUSTERS.noise) return { ...row, baseline: BASELINES.noise, baseline_kind: "noise", isBaselineCluster: true };
    if (row.cluster === CLUSTERS.medicalIntent) return { ...row, baseline: BASELINES.medicalIntent, baseline_kind: "medical", isBaselineCluster: true };
    return { ...row, baseline: null, baseline_kind: null, isBaselineCluster: false };
  });
}

function priorityRank(priority: ZarukuSeoOpportunityRow["priority"]) {
  if (priority === "high") return 0;
  if (priority === "medium") return 1;
  return 2;
}

function decisionRank(decision: ZarukuSeoOpportunityRow["decision"]) {
  if (decision === "approved") return 0;
  if (decision === "pending") return 1;
  return 2;
}

function topOpportunity(rows: ZarukuSeoOpportunityRow[], week: string | null) {
  return rows
    .filter((row) => row.week === week && (row.decision === "approved" || row.decision === "pending"))
    .sort(
      (left, right) =>
        Number(!left.target_url) - Number(!right.target_url) ||
        priorityRank(left.priority) - priorityRank(right.priority) ||
        decisionRank(left.decision) - decisionRank(right.decision) ||
        right.confidence - left.confidence ||
        left.title.localeCompare(right.title),
    )[0] ?? null;
}

function taskStatusSummary(tasks: ZarukuSeoTaskRow[]) {
  const counts = new Map<ZarukuSeoTaskStatus, number>();
  for (const task of tasks) counts.set(task.status, (counts.get(task.status) ?? 0) + 1);
  return [...counts.entries()].map(([status, count]) => `${TASK_LABELS[status]}: ${count}`).join(", ");
}

function readableOpportunityType(value: string) {
  const labels: Record<string, string> = {
    content_refresh: "обновление контента",
    internal_linking: "внутренняя перелинковка",
    new_content: "новый контент",
    title_meta: "title/meta",
    section_ranking_gap: "разрыв позиций раздела",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function readableRunStatus(value: ZarukuSeoRunRow["status"]) {
  const labels: Record<ZarukuSeoRunRow["status"], string> = {
    completed: "завершён",
    failed: "ошибка",
    missing: "нет запуска",
    noop: "без действий",
  };
  return labels[value] ?? value;
}

export function buildWeeklyFocus({
  opportunities,
  aiRows,
  tasks,
  runs,
  week,
}: {
  opportunities: ZarukuSeoOpportunityRow[];
  aiRows: ZarukuSeoAiVisibilityAggregateRow[];
  tasks: ZarukuSeoTaskRow[];
  runs: ZarukuSeoRunRow[];
  week: string | null;
}): WeeklyFocus {
  const effectiveWeek = week ?? [...new Set([...opportunities, ...tasks, ...runs].map((row) => row.week))].sort(sortText).at(-1) ?? null;
  const opportunity = topOpportunity(opportunities, effectiveWeek);
  const weekTasks = tasks.filter((task) => task.week === effectiveWeek);
  const sections = [...new Set(weekTasks.map((task) => task.section).filter((section): section is string => Boolean(section)))].join(", ");
  const run = runs.find((item) => item.week === effectiveWeek) ?? null;
  const ai = latestAiRow(aiRows);

  return {
    seo: opportunity
      ? `Фокус SEO: ${opportunity.section ?? opportunity.target_url ?? "раздел не задан"} — ${readableOpportunityType(opportunity.opportunity_type)}`
      : "Фокус SEO: нет ожидающих или принятых возможностей на выбранной неделе",
    ai: ai
      ? `ИИ: 67% цитирований Алисы приходится на 1 страницу — диверсификация через задачи ${sections || "выбранной недели"}`
      : `ИИ: ждём снимок видимости — диверсификация через задачи ${sections || "выбранной недели"}`,
    pipeline: run
      ? `Конвейер: ${run.week} ${readableRunStatus(run.status)}, дайджест ${run.digest_count ?? "—"}, ${taskStatusSummary(weekTasks) || "задач нет"}`
      : `Конвейер: ${effectiveWeek ?? "неделя не выбрана"} без телеметрии запуска, ${taskStatusSummary(weekTasks) || "задач нет"}`,
  };
}
