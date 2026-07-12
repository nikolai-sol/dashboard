"use client";

import { useMemo } from "react";
import { ExternalLink, Gauge, ListChecks } from "lucide-react";
import type { ZarukuSeoOsData, ZarukuSeoSource, ZarukuSeoTaskStatus } from "@/lib/types";
import { resolveSafeExternalUrl } from "@/components/zaruku-seo-analytics";
import {
  buildOpportunityDecisionSummary,
  buildRhythmRows,
  buildTaskStatusSummary,
  normalizeConfidencePercent,
} from "@/components/zaruku-seo-operations";

type Props = {
  seoOs: ZarukuSeoOsData;
  primaryWeek: string | null;
  comparisonWeek: string | null;
  source?: ZarukuSeoSource;
};

const DECISION_LABELS = {
  pending: "Ожидают решения",
  approved: "Одобрены",
  rejected: "Отклонены",
  carried_over: "Перенесены",
} as const;

const TASK_LABELS: Record<ZarukuSeoTaskStatus, string> = {
  draft: "Черновик",
  awaiting_medical_review: "Медицинская проверка",
  in_progress: "В работе",
  done: "Готово",
  cancelled: "Отменено",
};

function formatNumber(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
}

function formatRate(value: number | null) {
  return value == null ? "—" : `${formatNumber(value)}%`;
}

function safeLinkLabel(value: string) {
  const url = new URL(value);
  return `${url.hostname}${url.pathname === "/" ? "" : url.pathname}`;
}

function ExternalUrl({ value, label = "Открыть" }: { value: string | null; label?: string }) {
  const url = resolveSafeExternalUrl(value);
  if (!url) return <span className="text-slate-400">—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={url} className="inline-flex max-w-full items-center gap-1 text-teal-700 hover:text-teal-900 hover:underline">
      <span className="truncate">{label === "Открыть" ? safeLinkLabel(url) : label}</span>
      <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}

function taskBadgeClass(status: ZarukuSeoTaskStatus) {
  if (status === "awaiting_medical_review") return "border-red-300 bg-red-100 text-red-800";
  if (status === "done") return "border-teal-200 bg-teal-50 text-teal-700";
  if (status === "cancelled") return "border-slate-200 bg-slate-100 text-slate-500";
  if (status === "in_progress") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-white text-slate-600";
}

function runBadgeClass(status: ZarukuSeoOsData["runs"][number]["status"]) {
  if (status === "failed" || status === "missing") return "border-red-300 bg-red-50 text-red-800";
  if (status === "noop") return "border-slate-300 bg-slate-100 text-slate-600";
  return "border-teal-200 bg-teal-50 text-teal-700";
}

export default function ZarukuSeoOperations({ seoOs, primaryWeek, comparisonWeek, source }: Props) {
  const decisionSummary = useMemo(
    () => buildOpportunityDecisionSummary(seoOs.opportunities, primaryWeek, comparisonWeek),
    [comparisonWeek, primaryWeek, seoOs.opportunities],
  );
  const taskCounts = useMemo(() => buildTaskStatusSummary(seoOs.tasks, primaryWeek), [primaryWeek, seoOs.tasks]);
  const opportunities = useMemo(
    () => seoOs.opportunities
      .filter((row) => row.week === primaryWeek)
      .sort((left, right) => left.priority.localeCompare(right.priority) || right.confidence - left.confidence || left.title.localeCompare(right.title)),
    [primaryWeek, seoOs.opportunities],
  );
  const tasks = useMemo(
    () => seoOs.tasks.filter((row) => row.week === primaryWeek).sort((left, right) => left.title.localeCompare(right.title)),
    [primaryWeek, seoOs.tasks],
  );
  const rhythm = useMemo(() => buildRhythmRows(seoOs.runs, seoOs.weeks), [seoOs.runs, seoOs.weeks]);

  if (!seoOs.available) {
    return <section className="rounded-lg border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500">SEO Ops временно недоступен. Повторите попытку позже.</section>;
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-slate-200 bg-white">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Воронка SEO-решений</h3>
            <p className="mt-1 text-xs text-slate-500">{primaryWeek ?? "Выберите основную неделю"}</p>
          </div>
          {source ? <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600"><span className="h-1.5 w-1.5 rounded-full" style={{ background: source.color }} />{source.label}</span> : null}
        </header>
        <div className="grid gap-px bg-slate-100 sm:grid-cols-5">
          {Object.entries(DECISION_LABELS).map(([decision, label]) => <div key={decision} className="bg-white px-4 py-3"><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-xl font-semibold text-slate-900">{decisionSummary.counts[decision as keyof typeof decisionSummary.counts]}</div></div>)}
          <div className="bg-white px-4 py-3"><div className="text-xs text-slate-500">Approve rate</div><div className="mt-1 text-xl font-semibold text-slate-900">{formatRate(decisionSummary.approve_rate)}</div>{comparisonWeek && decisionSummary.approve_rate_delta != null ? <div className={decisionSummary.approve_rate_delta >= 0 ? "text-xs text-teal-700" : "text-xs text-red-700"}>A/B {decisionSummary.approve_rate_delta >= 0 ? "+" : ""}{formatRate(decisionSummary.approve_rate_delta)}</div> : null}</div>
        </div>
        <div className="max-h-[360px] overflow-auto px-5 py-4">
          <table className="w-full min-w-[920px] text-sm">
            <thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2 font-medium">Возможность</th><th className="pb-2 font-medium">Раздел</th><th className="pb-2 font-medium">Решение</th><th className="pb-2 font-medium">Приоритет</th><th className="pb-2 text-right font-medium">Confidence</th><th className="pb-2 font-medium">Target URL</th><th className="pb-2 font-medium">Причина отказа</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {opportunities.map((row) => <tr key={row.opportunity_id}><td className="max-w-64 py-2.5 font-medium text-slate-700">{row.title}</td><td className="py-2.5 text-slate-500">{row.section ?? "—"}</td><td className="py-2.5 text-slate-600">{DECISION_LABELS[row.decision]}</td><td className="py-2.5"><span className={row.priority === "high" ? "font-medium text-red-700" : row.priority === "medium" ? "font-medium text-amber-700" : "text-slate-600"}>{row.priority}</span></td><td className="py-2.5 text-right text-slate-600">{formatRate(normalizeConfidencePercent(row.confidence))}</td><td className="max-w-48 py-2.5"><ExternalUrl value={row.target_url} /></td><td className="max-w-56 py-2.5 text-slate-500">{row.reject_reason ?? "—"}</td></tr>)}
              {opportunities.length === 0 ? <tr><td colSpan={7} className="py-6 text-center text-sm text-slate-500">Нет возможностей для выбранной недели.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <header className="flex items-start gap-2 border-b border-slate-100 px-5 py-4"><ListChecks className="mt-0.5 h-4 w-4 text-teal-700" aria-hidden="true" /><div><h3 className="text-base font-semibold text-slate-900">Задачи</h3><p className="mt-1 text-xs text-slate-500">Статусы задач для {primaryWeek ?? "выбранной недели"}</p></div></header>
        <div className="grid gap-px bg-slate-100 sm:grid-cols-5">{Object.entries(TASK_LABELS).map(([status, label]) => <div key={status} className="bg-white px-4 py-3"><div className="text-xs text-slate-500">{label}</div><div className={status === "awaiting_medical_review" ? "mt-1 text-xl font-semibold text-red-700" : "mt-1 text-xl font-semibold text-slate-900"}>{taskCounts[status as ZarukuSeoTaskStatus]}</div></div>)}</div>
        {tasks.length === 0 ? <div className="px-5 py-7 text-center text-sm text-slate-500">ждёт первого approve</div> : <div className="max-h-[300px] overflow-auto px-5 py-4"><table className="w-full min-w-[680px] text-sm"><thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2 font-medium">Задача</th><th className="pb-2 font-medium">Раздел</th><th className="pb-2 font-medium">Статус</th><th className="pb-2 font-medium">Notion</th></tr></thead><tbody className="divide-y divide-slate-100">{tasks.map((task) => <tr key={task.task_id}><td className="py-2.5 font-medium text-slate-700">{task.title}</td><td className="py-2.5 text-slate-500">{task.section ?? "—"}</td><td className="py-2.5"><span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${taskBadgeClass(task.status)}`}>{TASK_LABELS[task.status]}</span></td><td className="py-2.5"><ExternalUrl value={task.notion_url} label="Открыть" /></td></tr>)}</tbody></table></div>}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <header className="flex items-start gap-2 border-b border-slate-100 px-5 py-4"><Gauge className="mt-0.5 h-4 w-4 text-teal-700" aria-hidden="true" /><div><h3 className="text-base font-semibold text-slate-900">Ритм pipeline</h3><p className="mt-1 text-xs text-slate-500">SERP budget: 50 запросов в календарную неделю</p></div></header>
        <div className="max-h-[360px] overflow-auto px-5 py-4"><table className="w-full min-w-[700px] text-sm"><thead><tr className="text-left text-xs uppercase text-slate-400"><th className="pb-2 font-medium">Неделя</th><th className="pb-2 font-medium">Статус</th><th className="pb-2 text-right font-medium">SERP</th><th className="pb-2 text-right font-medium">LLM tokens</th><th className="pb-2 text-right font-medium">Digest</th></tr></thead><tbody className="divide-y divide-slate-100">{rhythm.map((run) => <tr key={run.week}><td className="py-2.5 font-medium text-slate-700">{run.week}</td><td className="py-2.5"><span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${runBadgeClass(run.status)}`}>{run.status}</span></td><td className="py-2.5 text-right text-slate-600">{formatNumber(run.serp_requests)} / 50</td><td className="py-2.5 text-right text-slate-600">{formatNumber(run.llm_tokens)}</td><td className="py-2.5 text-right text-slate-600">{formatNumber(run.digest_count)}</td></tr>)}{rhythm.length === 0 ? <tr><td colSpan={5} className="py-6 text-center text-sm text-slate-500">Нет telemetry по календарным неделям.</td></tr> : null}</tbody></table></div>
      </section>
    </div>
  );
}
