"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Eye,
  Lightbulb,
  MousePointerClick,
  PieChart as PieChartIcon,
  Search,
  Sparkles,
  Target,
} from "lucide-react";

type PlatformId = "google_ads" | "linkedin" | "reddit" | "meta" | "x";
type MonthKey = "all" | "march" | "april";

type PlatformMeta = {
  id: PlatformId;
  label: string;
  short: string;
  color: string;
  accent: string;
  objective: string;
};

type DailyRow = {
  date: string;
  month: "March" | "April";
  platform: PlatformId;
  spend: number;
  impressions: number;
  views: number;
  clicks: number;
  conversions: number;
};

const PLATFORMS: PlatformMeta[] = [
  {
    id: "google_ads",
    label: "Google Ads",
    short: "GO",
    color: "#34A853",
    accent: "#E8F5EE",
    objective: "High-intent demand capture",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    short: "IN",
    color: "#0A66C2",
    accent: "#E8F1FB",
    objective: "B2B audience quality",
  },
  {
    id: "reddit",
    label: "Reddit",
    short: "RD",
    color: "#FF4500",
    accent: "#FFF0E9",
    objective: "Community-led awareness",
  },
  {
    id: "meta",
    label: "Meta",
    short: "ME",
    color: "#1877F2",
    accent: "#EAF2FF",
    objective: "Reach and video scale",
  },
  {
    id: "x",
    label: "X",
    short: "X",
    color: "#111827",
    accent: "#EEF0F3",
    objective: "Conversation and launch pulse",
  },
];

const MONTHS: Record<Exclude<MonthKey, "all">, { label: string; from: string; to: string }> = {
  march: { label: "March", from: "2026-03-01", to: "2026-03-31" },
  april: { label: "April", from: "2026-04-01", to: "2026-04-30" },
};

const MONTH_TABS: Array<{ key: MonthKey; label: string }> = [
  { key: "all", label: "Mar + Apr" },
  { key: "march", label: "March" },
  { key: "april", label: "April" },
];

const BASE = {
  google_ads: { spend: 1180, cpm: 9.4, ctr: 0.015, viewRate: 0.3, cvRate: 0.055 },
  linkedin: { spend: 950, cpm: 32, ctr: 0.009, viewRate: 0.22, cvRate: 0.075 },
  reddit: { spend: 620, cpm: 7.8, ctr: 0.007, viewRate: 0.34, cvRate: 0.025 },
  meta: { spend: 1040, cpm: 11.8, ctr: 0.012, viewRate: 0.62, cvRate: 0.032 },
  x: { spend: 520, cpm: 10.6, ctr: 0.0065, viewRate: 0.28, cvRate: 0.018 },
} satisfies Record<PlatformId, { spend: number; cpm: number; ctr: number; viewRate: number; cvRate: number }>;

function seededNoise(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function buildDates(from: string, to: string) {
  const dates: string[] = [];
  const current = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function makeRows(): DailyRow[] {
  const months = [
    { name: "March" as const, dates: buildDates(MONTHS.march.from, MONTHS.march.to), lift: 0.96 },
    { name: "April" as const, dates: buildDates(MONTHS.april.from, MONTHS.april.to), lift: 1.14 },
  ];
  const rows: DailyRow[] = [];

  months.forEach((month, monthIndex) => {
    month.dates.forEach((date, dayIndex) => {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const weekdayLift = weekday === 0 || weekday === 6 ? 0.82 : 1.07;
      const wave = 1 + Math.sin((dayIndex / 8) * Math.PI) * 0.13;

      PLATFORMS.forEach((platform, platformIndex) => {
        const config = BASE[platform.id];
        const noise = 0.88 + seededNoise((monthIndex + 1) * 1000 + dayIndex * 37 + platformIndex * 11) * 0.28;
        const spend = config.spend * month.lift * weekdayLift * wave * noise;
        const impressions = Math.round((spend / config.cpm) * 1000);
        const clicks = Math.round(impressions * config.ctr * (0.9 + seededNoise(dayIndex + platformIndex * 19) * 0.24));
        const views = Math.round(impressions * config.viewRate * (0.86 + seededNoise(dayIndex * 3 + platformIndex) * 0.22));
        const conversions = Math.round(clicks * config.cvRate * (0.85 + seededNoise(dayIndex * 5 + platformIndex) * 0.3));

        rows.push({
          date,
          month: month.name,
          platform: platform.id,
          spend: Math.round(spend),
          impressions,
          views,
          clicks,
          conversions,
        });
      });
    });
  });

  return rows;
}

const MOCK_ROWS = makeRows();

function subscribeToClientSnapshot() {
  return () => {};
}

function getClientSnapshot() {
  return true;
}

function getServerSnapshot() {
  return false;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

function platformLabel(id: PlatformId) {
  return PLATFORMS.find((platform) => platform.id === id)?.label ?? id;
}

function platformColor(id: PlatformId) {
  return PLATFORMS.find((platform) => platform.id === id)?.color ?? "#64748B";
}

function sumRows(rows: DailyRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.spend += row.spend;
      acc.impressions += row.impressions;
      acc.views += row.views;
      acc.clicks += row.clicks;
      acc.conversions += row.conversions;
      return acc;
    },
    { spend: 0, impressions: 0, views: 0, clicks: 0, conversions: 0 },
  );
}

export default function RagDemoDashboard() {
  const [month, setMonth] = useState<MonthKey>("all");
  const isMounted = useSyncExternalStore(subscribeToClientSnapshot, getClientSnapshot, getServerSnapshot);

  const rows = useMemo(() => {
    if (month === "all") return MOCK_ROWS;
    const selected = MONTHS[month].label;
    return MOCK_ROWS.filter((row) => row.month === selected);
  }, [month]);

  const totals = useMemo(() => sumRows(rows), [rows]);
  const platformRows = useMemo(
    () =>
      PLATFORMS.map((platform) => {
        const platformTotals = sumRows(rows.filter((row) => row.platform === platform.id));
        const ctr = platformTotals.impressions > 0 ? (platformTotals.clicks / platformTotals.impressions) * 100 : 0;
        const cpm = platformTotals.impressions > 0 ? (platformTotals.spend / platformTotals.impressions) * 1000 : 0;
        const cpv = platformTotals.views > 0 ? platformTotals.spend / platformTotals.views : 0;
        return {
          ...platform,
          ...platformTotals,
          ctr,
          cpm,
          cpv,
          share: totals.spend > 0 ? (platformTotals.spend / totals.spend) * 100 : 0,
        };
      }).sort((a, b) => b.spend - a.spend),
    [rows, totals.spend],
  );

  const dailyTrend = useMemo(() => {
    const byDate = new Map<string, { date: string; spend: number; impressions: number; views: number; clicks: number }>();
    rows.forEach((row) => {
      const current = byDate.get(row.date) ?? { date: row.date, spend: 0, impressions: 0, views: 0, clicks: 0 };
      current.spend += row.spend;
      current.impressions += row.impressions;
      current.views += row.views;
      current.clicks += row.clicks;
      byDate.set(row.date, current);
    });
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [rows]);

  const monthlyComparison = useMemo(() => {
    return Object.values(MONTHS).map((item) => {
      const monthRows = MOCK_ROWS.filter((row) => row.month === item.label);
      const monthTotals = sumRows(monthRows);
      return {
        month: item.label,
        spend: monthTotals.spend,
        impressions: monthTotals.impressions,
        views: monthTotals.views,
        clicks: monthTotals.clicks,
        conversions: monthTotals.conversions,
      };
    });
  }, []);

  const funnel = useMemo(
    () => [
      { label: "Impressions", value: totals.impressions, color: "#0A66C2" },
      { label: "Views", value: totals.views, color: "#34A853" },
      { label: "Clicks", value: totals.clicks, color: "#FF4500" },
      { label: "Conversions", value: totals.conversions, color: "#111827" },
    ],
    [totals],
  );

  const ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;
  const viewRate = totals.impressions > 0 ? (totals.views / totals.impressions) * 100 : 0;
  const topSpendPlatform = platformRows[0];
  const topEfficiencyPlatform = [...platformRows].sort((a, b) => a.cpv - b.cpv)[0];

  return (
    <main className="min-h-screen bg-[#F6F8FB] px-4 py-5 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-5">
        <header className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase text-slate-500">
              <span className="rounded-md border border-slate-200 bg-white px-2 py-1">RAG Demo</span>
              <span className="rounded-md border border-slate-200 bg-white px-2 py-1">Customer View</span>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
              Paid Media Intelligence Dashboard
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600 sm:text-base">
              Mock March and April performance across Google Ads, LinkedIn, Reddit, Meta, and X.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {MONTH_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setMonth(tab.key)}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                  month === tab.key
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                }`}
              >
                <CalendarDays className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={Eye} label="Impressions" value={formatNumber(totals.impressions)} detail="+18.4% vs prior demo period" />
          <MetricCard icon={Activity} label="Views" value={formatNumber(totals.views)} detail={`${viewRate.toFixed(1)}% view rate`} />
          <MetricCard icon={MousePointerClick} label="Clicks" value={formatNumber(totals.clicks)} detail={`${pct(ctr)} CTR`} />
          <MetricCard icon={Target} label="Conversions" value={formatNumber(totals.conversions)} detail="Qualified demo actions" />
          <MetricCard icon={BarChart3} label="Spend" value={formatCurrency(totals.spend)} detail={`${formatCurrency(cpm)} CPM`} />
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
          <Panel title="AI Summary" icon={Sparkles}>
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm leading-6 text-slate-700">
                  Across the selected period, the campaign delivered{" "}
                  <span className="font-semibold text-slate-950">{formatNumber(totals.impressions)} impressions</span> and{" "}
                  <span className="font-semibold text-slate-950">{formatNumber(totals.views)} views</span> across five paid media sources.
                  The strongest scale driver is{" "}
                  <span className="font-semibold text-slate-950">{topSpendPlatform?.label}</span>, while{" "}
                  <span className="font-semibold text-slate-950">{topEfficiencyPlatform?.label}</span> is currently the most efficient source
                  by CPV.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <AiInsight
                  icon={CheckCircle2}
                  title="What is working"
                  text="Meta and Google Ads are carrying scalable reach while keeping CPM stable enough for awareness growth."
                />
                <AiInsight
                  icon={Lightbulb}
                  title="Next action"
                  text="Shift a small test budget into the lowest-CPV source and monitor whether view quality holds through April."
                />
                <AiInsight
                  icon={AlertTriangle}
                  title="Watch item"
                  text="LinkedIn has higher cost, but it should stay in the mix when lead quality matters more than pure reach."
                />
              </div>
            </div>
          </Panel>

          <Panel title="AI Recommendations" icon={Lightbulb}>
            <div className="space-y-3">
              {[
                "Keep Google Ads always-on for demand capture and retargeting support.",
                "Use Meta as the main reach engine, then cap frequency before saturation.",
                "Use Reddit for community-specific messaging tests before scaling creative.",
                "Treat LinkedIn as a premium audience layer, not a low-cost reach channel.",
              ].map((item) => (
                <div key={item} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-950 text-xs font-bold text-white">
                    AI
                  </span>
                  <p className="text-sm leading-5 text-slate-700">{item}</p>
                </div>
              ))}
            </div>
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.45fr_0.85fr]">
          <Panel title="Daily Delivery Trend" icon={Sparkles}>
            <div className="h-[360px]">
              {isMounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyTrend} margin={{ top: 12, right: 18, bottom: 0, left: 0 }}>
                    <defs>
                      <linearGradient id="viewsFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="5%" stopColor="#0A66C2" stopOpacity={0.22} />
                        <stop offset="95%" stopColor="#0A66C2" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(5)} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(value) => formatNumber(Number(value))} tickLine={false} axisLine={false} width={58} />
                    <Tooltip content={<DemoTooltip />} />
                    <Legend />
                    <Area type="monotone" dataKey="views" name="Views" stroke="#0A66C2" fill="url(#viewsFill)" strokeWidth={3} />
                    <Line type="monotone" dataKey="clicks" name="Clicks" stroke="#FF4500" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <ChartSkeleton />
              )}
            </div>
          </Panel>

          <Panel title="Spend Mix" icon={PieChartIcon}>
            <div className="h-[360px]">
              {isMounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={platformRows}
                      dataKey="spend"
                      nameKey="label"
                      innerRadius={78}
                      outerRadius={122}
                      paddingAngle={2}
                      stroke="#FFFFFF"
                      strokeWidth={2}
                    >
                      {platformRows.map((entry) => (
                        <Cell key={entry.id} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<DemoTooltip currencyKeys={new Set(["spend"])} />} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <ChartSkeleton />
              )}
            </div>
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <Panel title="Platform Performance" icon={BarChart3}>
            <div className="h-[340px]">
              {isMounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={platformRows} layout="vertical" margin={{ top: 8, right: 24, bottom: 4, left: 92 }}>
                    <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" horizontal={false} />
                    <XAxis type="number" tickFormatter={(value) => formatNumber(Number(value))} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="label" axisLine={false} tickLine={false} width={92} />
                    <Tooltip content={<DemoTooltip />} />
                    <Bar dataKey="impressions" name="Impressions" radius={[0, 8, 8, 0]}>
                      {platformRows.map((entry) => (
                        <Cell key={entry.id} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartSkeleton />
              )}
            </div>
          </Panel>

          <Panel title="March vs April" icon={CalendarDays}>
            <div className="h-[340px]">
              {isMounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyComparison} margin={{ top: 8, right: 18, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#E2E8F0" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="month" axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={(value) => formatNumber(Number(value))} axisLine={false} tickLine={false} width={58} />
                    <Tooltip content={<DemoTooltip currencyKeys={new Set(["spend"])} />} />
                    <Legend />
                    <Bar dataKey="impressions" name="Impressions" fill="#0A66C2" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="views" name="Views" fill="#34A853" radius={[8, 8, 0, 0]} />
                    <Bar dataKey="clicks" name="Clicks" fill="#FF4500" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartSkeleton />
              )}
            </div>
          </Panel>
        </section>

        <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <Panel title="Funnel Snapshot" icon={Target}>
            <div className="space-y-3">
              {funnel.map((step, index) => {
                const firstValue = funnel[0]?.value || 1;
                const width = Math.max(18, (step.value / firstValue) * 100);
                return (
                  <div key={step.label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold text-slate-800">{step.label}</span>
                      <span className="font-mono text-slate-600">{formatNumber(step.value)}</span>
                    </div>
                    <div className="mt-2 h-7 rounded-md bg-white">
                      <div
                        className="flex h-7 items-center justify-end rounded-md px-2 text-xs font-bold text-white"
                        style={{ width: `${width}%`, backgroundColor: step.color }}
                      >
                        {index === 0 ? "100%" : `${((step.value / firstValue) * 100).toFixed(1)}%`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Source Readiness Story" icon={Search}>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Source</th>
                    <th className="px-4 py-3">Role</th>
                    <th className="px-4 py-3 text-right">Spend</th>
                    <th className="px-4 py-3 text-right">Impressions</th>
                    <th className="px-4 py-3 text-right">CTR</th>
                    <th className="px-4 py-3 text-right">CPV</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 bg-white">
                  {platformRows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span
                            className="flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold"
                            style={{ backgroundColor: row.accent, color: row.color }}
                          >
                            {row.short}
                          </span>
                          <span className="font-semibold text-slate-900">{row.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.objective}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatCurrency(row.spend)}</td>
                      <td className="px-4 py-3 text-right font-mono">{formatNumber(row.impressions)}</td>
                      <td className="px-4 py-3 text-right font-mono">{pct(row.ctr)}</td>
                      <td className="px-4 py-3 text-right font-mono">€{row.cpv.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </section>
      </div>
    </main>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
        </div>
        <span className="rounded-lg bg-slate-100 p-2 text-slate-700">
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Eye;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <span className="rounded-md bg-slate-100 p-2 text-slate-700">
          <Icon className="h-4 w-4" />
        </span>
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function AiInsight({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Eye;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-slate-100 p-1.5 text-slate-700">
          <Icon className="h-4 w-4" />
        </span>
        <p className="text-sm font-semibold text-slate-950">{title}</p>
      </div>
      <p className="mt-2 text-sm leading-5 text-slate-600">{text}</p>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex h-full items-end gap-2 rounded-lg bg-slate-50 p-4">
      {[42, 64, 52, 76, 58, 88, 70, 96, 78, 62].map((height, index) => (
        <div
          key={index}
          className="flex-1 rounded-t-md bg-slate-200"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}

function DemoTooltip({
  active,
  payload,
  label,
  currencyKeys = new Set<string>(),
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; dataKey?: string; color?: string; payload?: { platform?: PlatformId; label?: string } }>;
  label?: string;
  currencyKeys?: Set<string>;
}) {
  if (!active || !payload?.length) return null;
  const title = payload[0]?.payload?.label ?? (payload[0]?.payload?.platform ? platformLabel(payload[0].payload.platform) : label);

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold text-slate-900">{title}</p>
      <div className="space-y-1">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? "");
          const value = Number(item.value ?? 0);
          const display = currencyKeys.has(key) ? formatCurrency(value) : formatNumber(value);
          return (
            <div key={`${key}-${item.name}`} className="flex items-center justify-between gap-5 text-slate-700">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color ?? platformColor(item.payload?.platform ?? "google_ads") }} />
                {item.name ?? key}
              </span>
              <span className="font-mono">{display}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
