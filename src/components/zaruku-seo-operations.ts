import type {
  ZarukuSeoOpportunityDecision,
  ZarukuSeoOpportunityRow,
  ZarukuSeoRunRow,
  ZarukuSeoTaskRow,
  ZarukuSeoTaskStatus,
} from "@/lib/types";

const OPPORTUNITY_DECISIONS: ZarukuSeoOpportunityDecision[] = ["pending", "approved", "rejected", "carried_over"];
const TASK_STATUSES: ZarukuSeoTaskStatus[] = ["draft", "awaiting_medical_review", "needs_target_page", "in_progress", "done", "cancelled"];
const DECISION_RANK = { pending: 0, approved: 1, carried_over: 2, rejected: 3 } as const;
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;
const TASK_STATUS_RANK = {
  awaiting_medical_review: 0,
  needs_target_page: 1,
  in_progress: 2,
  draft: 3,
  done: 4,
  cancelled: 5,
} as const;
const OPPORTUNITY_TYPE_LABELS: Record<string, string> = {
  content_refresh: "Обновить контент",
  internal_linking: "Усилить внутреннюю перелинковку",
  new_content: "Подготовить новый контент",
  title_meta: "Улучшить title и description",
  section_ranking_gap: "Закрыть разрыв позиций раздела",
};

export type OpportunityDecisionCounts = Record<ZarukuSeoOpportunityDecision, number>;
export type TaskStatusCounts = Record<ZarukuSeoTaskStatus, number>;

export type OpportunityDecisionSummary = {
  counts: OpportunityDecisionCounts;
  comparison_counts: OpportunityDecisionCounts | null;
  count_deltas: OpportunityDecisionCounts | null;
  approve_rate: number | null;
  comparison_approve_rate: number | null;
  approve_rate_delta: number | null;
};

export function formatRunMetric(value: number | null, budget?: number) {
  if (value == null) return "—";
  const formatted = value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  return budget == null ? formatted : `${formatted} / ${budget}`;
}

export function normalizeConfidencePercent(value: number) {
  return value;
}

export function sortSeoOpportunities<T extends Pick<ZarukuSeoOpportunityRow, "decision" | "priority" | "confidence" | "title">>(rows: T[]): T[] {
  return [...rows].sort((left, right) =>
    DECISION_RANK[left.decision] - DECISION_RANK[right.decision]
      || PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
      || right.confidence - left.confidence
      || left.title.localeCompare(right.title, "ru-RU"));
}

export function sortSeoTasks<T extends Pick<ZarukuSeoTaskRow, "status" | "title">>(rows: T[]): T[] {
  return [...rows].sort((left, right) =>
    TASK_STATUS_RANK[left.status] - TASK_STATUS_RANK[right.status]
      || left.title.localeCompare(right.title, "ru-RU"));
}

export function formatOpportunityTitle(row: Pick<ZarukuSeoOpportunityRow, "title" | "opportunity_type">): string {
  const title = row.title.trim();
  const looksInternal = !title || title === row.opportunity_type || title.startsWith(`${row.opportunity_type}:`);
  return looksInternal ? (OPPORTUNITY_TYPE_LABELS[row.opportunity_type] ?? "SEO-возможность для раздела") : title;
}

function emptyDecisionCounts(): OpportunityDecisionCounts {
  return { pending: 0, approved: 0, rejected: 0, carried_over: 0 };
}

function emptyTaskCounts(): TaskStatusCounts {
  return { draft: 0, awaiting_medical_review: 0, needs_target_page: 0, in_progress: 0, done: 0, cancelled: 0 };
}

function countDeltas<Key extends string>(
  primary: Record<Key, number>,
  comparison: Record<Key, number>,
  keys: readonly Key[],
) {
  const deltas = {} as Record<Key, number>;
  for (const key of keys) deltas[key] = primary[key] - comparison[key];
  return deltas;
}

function approveRate(counts: OpportunityDecisionCounts) {
  const decided = counts.approved + counts.rejected;
  return decided === 0 ? null : (counts.approved / decided) * 100;
}

function decisionCountsForWeek(rows: ZarukuSeoOpportunityRow[], week: string | null) {
  const counts = emptyDecisionCounts();
  if (!week) return counts;
  for (const row of rows) {
    if (row.week === week && OPPORTUNITY_DECISIONS.includes(row.decision)) counts[row.decision] += 1;
  }
  return counts;
}

export function buildOpportunityDecisionSummary(
  rows: ZarukuSeoOpportunityRow[],
  primaryWeek: string | null,
  comparisonWeek: string | null,
): OpportunityDecisionSummary {
  const counts = decisionCountsForWeek(rows, primaryWeek);
  const approve_rate = approveRate(counts);
  const comparison_counts = comparisonWeek ? decisionCountsForWeek(rows, comparisonWeek) : null;
  const comparison_approve_rate = comparison_counts ? approveRate(comparison_counts) : null;
  return {
    counts,
    comparison_counts,
    count_deltas: comparison_counts ? countDeltas(counts, comparison_counts, OPPORTUNITY_DECISIONS) : null,
    approve_rate,
    comparison_approve_rate,
    approve_rate_delta: approve_rate != null && comparison_approve_rate != null ? approve_rate - comparison_approve_rate : null,
  };
}

function taskCountsForWeek(rows: ZarukuSeoTaskRow[], week: string | null): TaskStatusCounts {
  const counts = emptyTaskCounts();
  if (!week) return counts;
  for (const row of rows) {
    if (row.week === week && TASK_STATUSES.includes(row.status)) counts[row.status] += 1;
  }
  return counts;
}

export function buildTaskStatusSummary(
  rows: ZarukuSeoTaskRow[],
  primaryWeek: string | null,
  comparisonWeek: string | null = null,
) {
  const counts = taskCountsForWeek(rows, primaryWeek);
  const comparison_counts = comparisonWeek ? taskCountsForWeek(rows, comparisonWeek) : null;
  return {
    counts,
    comparison_counts,
    count_deltas: comparison_counts ? countDeltas(counts, comparison_counts, TASK_STATUSES) : null,
  };
}

export function buildRunComparison(
  rows: ZarukuSeoRunRow[],
  primaryWeek: string | null,
  comparisonWeek: string | null,
) {
  const primary = rows.find((row) => row.week === primaryWeek) ?? null;
  const comparison = rows.find((row) => row.week === comparisonWeek) ?? null;
  const comparable = primary?.status !== "missing" && comparison?.status !== "missing";
  const delta = (key: "serp_requests" | "llm_tokens" | "digest_count") => {
    const primaryValue = primary?.[key];
    const comparisonValue = comparison?.[key];
    return comparable && primaryValue != null && comparisonValue != null ? primaryValue - comparisonValue : null;
  };
  return {
    primary,
    comparison,
    deltas: {
      serp_requests: delta("serp_requests"),
      llm_tokens: delta("llm_tokens"),
      digest_count: delta("digest_count"),
    },
  };
}

export function buildRhythmRows(rows: ZarukuSeoRunRow[], weeks: string[]): ZarukuSeoRunRow[] {
  const byWeek = new Map(rows.map((row) => [row.week, row]));
  const rhythmWeeks = [...new Set([...weeks, ...rows.map((row) => row.week)])].sort((left, right) => left.localeCompare(right));
  return rhythmWeeks.map((week) => byWeek.get(week) ?? {
    week,
    status: "missing" as const,
    serp_requests: null,
    llm_tokens: null,
    digest_count: null,
  });
}
