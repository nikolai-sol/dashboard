import { fileURLToPath } from "node:url";
import path from "node:path";

type MetricRow = Record<string, unknown>;

export type AdvertisingDashboardSnapshot = {
  dashboard_id: number;
  client_id: string;
  period: { from: string; to: string };
  plan_vs_fact: Array<MetricRow & { line_key?: string; channel: string; instrument?: string }>;
  channel_timeseries: Array<MetricRow & {
    line_key?: string;
    date: string;
    channel: string;
    instrument?: string;
  }>;
  unbound_facts: UnboundFactSummary[];
};

export type UnboundFactSummary = {
  canonical_campaign_id: number | null;
  source_key: string;
  platform_account_id: string;
  platform_campaign_id: string;
  campaign_name: string;
  first_date: string;
  last_date: string;
  impressions: number;
  clicks: number;
  spend: number;
  views: number;
  reach: number;
  conversions: number;
};

export type AdvertisingReadModelMismatch = {
  dashboard_id: number;
  client_id: string;
  scope: "line_period" | "line_daily" | "dashboard_daily";
  line_key: string;
  date: string | null;
  metric: string;
  old_value: number;
  new_value: number;
  delta: number;
};

export type AdvertisingDashboardComparison = {
  dashboard_id: number;
  client_id: string;
  period: { from: string; to: string };
  status: "match" | "blocked";
  mismatches: AdvertisingReadModelMismatch[];
  unbound_facts: UnboundFactSummary[];
};

const PERIOD_METRICS = [
  "budget_plan",
  "impressions_plan",
  "reach_plan",
  "clicks_plan",
  "views_plan",
  "conversions_plan",
  "budget_fact",
  "impressions_fact",
  "reach_fact",
  "clicks_fact",
  "views_fact",
  "conversions_fact",
] as const;

const DAILY_METRICS = ["impressions", "reach", "clicks", "spend", "views", "conversions"] as const;

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rounded(value: number): number {
  return Number(value.toFixed(6));
}

function lineKey(row: { line_key?: string; channel: string; instrument?: string }): string {
  return String(row.line_key ?? "").trim() || `${row.channel}::${row.instrument ?? ""}`;
}

function aggregateRows(
  rows: MetricRow[],
  keyFor: (row: MetricRow) => string,
  metrics: readonly string[],
): Map<string, Record<string, number>> {
  const result = new Map<string, Record<string, number>>();
  for (const row of rows) {
    const key = keyFor(row);
    const current = result.get(key) ?? Object.fromEntries(metrics.map((metric) => [metric, 0]));
    for (const metric of metrics) current[metric] += numeric(row[metric]);
    result.set(key, current);
  }
  return result;
}

function compareMaps(
  oldRows: Map<string, Record<string, number>>,
  newRows: Map<string, Record<string, number>>,
  metrics: readonly string[],
  context: {
    dashboardId: number;
    clientId: string;
    scope: AdvertisingReadModelMismatch["scope"];
    parseKey: (key: string) => { lineKey: string; date: string | null };
  },
): AdvertisingReadModelMismatch[] {
  const mismatches: AdvertisingReadModelMismatch[] = [];
  const keys = Array.from(new Set([...oldRows.keys(), ...newRows.keys()])).sort();
  for (const key of keys) {
    for (const metric of metrics) {
      const oldValue = rounded(oldRows.get(key)?.[metric] ?? 0);
      const newValue = rounded(newRows.get(key)?.[metric] ?? 0);
      const delta = rounded(newValue - oldValue);
      if (Math.abs(delta) <= 0.000001) continue;
      const identity = context.parseKey(key);
      mismatches.push({
        dashboard_id: context.dashboardId,
        client_id: context.clientId,
        scope: context.scope,
        line_key: identity.lineKey,
        date: identity.date,
        metric,
        old_value: oldValue,
        new_value: newValue,
        delta,
      });
    }
  }
  return mismatches;
}

export function compareAdvertisingDashboardSnapshots(
  oldSnapshot: AdvertisingDashboardSnapshot,
  newSnapshot: AdvertisingDashboardSnapshot,
): AdvertisingDashboardComparison {
  if (oldSnapshot.dashboard_id !== newSnapshot.dashboard_id) {
    throw new Error("cannot compare different dashboards");
  }

  const periodOld = aggregateRows(
    oldSnapshot.plan_vs_fact,
    (row) => lineKey(row as AdvertisingDashboardSnapshot["plan_vs_fact"][number]),
    PERIOD_METRICS,
  );
  const periodNew = aggregateRows(
    newSnapshot.plan_vs_fact,
    (row) => lineKey(row as AdvertisingDashboardSnapshot["plan_vs_fact"][number]),
    PERIOD_METRICS,
  );
  const dailyKey = (row: MetricRow) => {
    const value = row as AdvertisingDashboardSnapshot["channel_timeseries"][number];
    return `${lineKey(value)}\u0000${value.date}`;
  };
  const dailyOld = aggregateRows(oldSnapshot.channel_timeseries, dailyKey, DAILY_METRICS);
  const dailyNew = aggregateRows(newSnapshot.channel_timeseries, dailyKey, DAILY_METRICS);
  const dashboardDailyOld = aggregateRows(oldSnapshot.channel_timeseries, (row) => String(row.date), DAILY_METRICS);
  const dashboardDailyNew = aggregateRows(newSnapshot.channel_timeseries, (row) => String(row.date), DAILY_METRICS);
  const baseContext = { dashboardId: newSnapshot.dashboard_id, clientId: newSnapshot.client_id };
  const mismatches = [
    ...compareMaps(periodOld, periodNew, PERIOD_METRICS, {
      ...baseContext,
      scope: "line_period",
      parseKey: (key) => ({ lineKey: key, date: null }),
    }),
    ...compareMaps(dailyOld, dailyNew, DAILY_METRICS, {
      ...baseContext,
      scope: "line_daily",
      parseKey: (key) => {
        const [keyLine, date] = key.split("\u0000");
        return { lineKey: keyLine, date };
      },
    }),
    ...compareMaps(dashboardDailyOld, dashboardDailyNew, DAILY_METRICS, {
      ...baseContext,
      scope: "dashboard_daily",
      parseKey: (date) => ({ lineKey: "__dashboard_total__", date }),
    }),
  ];
  const unboundFacts = newSnapshot.unbound_facts;
  return {
    dashboard_id: newSnapshot.dashboard_id,
    client_id: newSnapshot.client_id,
    period: newSnapshot.period,
    status: mismatches.length || unboundFacts.length ? "blocked" : "match",
    mismatches,
    unbound_facts: unboundFacts,
  };
}

export function comparisonExitCode(comparisons: AdvertisingDashboardComparison[]): number {
  return comparisons.some((item) => item.mismatches.length > 0 || item.unbound_facts.length > 0) ? 1 : 0;
}

function parseArgs(args: string[]) {
  const dashboards: string[] = [];
  let from = "";
  let to = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dashboard") dashboards.push(String(args[++index] ?? "").trim());
    else if (arg === "--from") from = String(args[++index] ?? "").trim();
    else if (arg === "--to") to = String(args[++index] ?? "").trim();
    else throw new Error(`unknown argument: ${arg}`);
  }
  const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if ((from || to) && (!isDate(from) || !isDate(to) || from > to)) {
    throw new Error("--from and --to must be a valid ordered ISO date pair");
  }
  return { dashboards: dashboards.filter(Boolean), from, to };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [{ default: pool }, { loadDashboardData }, { loadBoundAdvertisingFacts }] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/dashboard-data-loader"),
    import("../src/lib/advertising-binding-read-model"),
  ]);
  const previousFlag = process.env.AD_CANONICAL_READ_V2;
  try {
    const [rawDashboards] = await pool.execute(
      `SELECT id, client_id
       FROM dashboards
       WHERE is_active = TRUE
         AND dashboard_type NOT IN ('abbott_bi', 'zaruku_bi')
       ORDER BY CASE WHEN client_id = 'gidrofuril' THEN 0 ELSE 1 END, id`,
    );
    const selected = (rawDashboards as Array<{ id: number; client_id: string }>).filter((dashboard) =>
      options.dashboards.length === 0 ||
      options.dashboards.includes(String(dashboard.id)) ||
      options.dashboards.includes(dashboard.client_id),
    );
    if (!selected.length) throw new Error("no active advertising dashboards selected");

    const comparisons: AdvertisingDashboardComparison[] = [];
    for (const dashboard of selected) {
      const params = new URLSearchParams();
      if (options.from) params.set("from", options.from);
      if (options.to) params.set("to", options.to);
      const suffix = params.size ? `?${params.toString()}` : "";
      const requestUrl = `http://localhost/dashboard/${dashboard.id}${suffix}`;

      process.env.AD_CANONICAL_READ_V2 = "0";
      const oldLoaded = await loadDashboardData(new Request(requestUrl), String(dashboard.id));
      process.env.AD_CANONICAL_READ_V2 = "1";
      const newLoaded = await loadDashboardData(new Request(requestUrl), String(dashboard.id));
      const period = newLoaded.data.dashboard.period;
      const readModel = await loadBoundAdvertisingFacts(dashboard.id, period.from, period.to);
      const unboundFacts = new Map<string, UnboundFactSummary>();
      for (const fact of readModel.unboundFacts) {
        const key = `${fact.sourceKey}\u0000${fact.platformAccountId}\u0000${fact.platformCampaignId}`;
        const row = unboundFacts.get(key) ?? {
          canonical_campaign_id: fact.canonicalCampaignId,
          source_key: fact.sourceKey,
          platform_account_id: fact.platformAccountId,
          platform_campaign_id: fact.platformCampaignId,
          campaign_name: fact.campaignName,
          first_date: fact.date,
          last_date: fact.date,
          impressions: 0,
          clicks: 0,
          spend: 0,
          views: 0,
          reach: 0,
          conversions: 0,
        };
        row.first_date = fact.date < row.first_date ? fact.date : row.first_date;
        row.last_date = fact.date > row.last_date ? fact.date : row.last_date;
        for (const metric of DAILY_METRICS) row[metric] += numeric(fact[metric]);
        unboundFacts.set(key, row);
      }
      const toSnapshot = (
        loaded: Awaited<ReturnType<typeof loadDashboardData>>,
        unbound_facts: UnboundFactSummary[],
      ): AdvertisingDashboardSnapshot => ({
        dashboard_id: dashboard.id,
        client_id: dashboard.client_id,
        period: loaded.data.dashboard.period,
        plan_vs_fact: loaded.data.plan_vs_fact.map((row) => ({ ...row }) as AdvertisingDashboardSnapshot["plan_vs_fact"][number]),
        channel_timeseries: (loaded.data.channel_timeseries ?? []).map(
          (row) => ({ ...row }) as AdvertisingDashboardSnapshot["channel_timeseries"][number],
        ),
        unbound_facts,
      });
      comparisons.push(compareAdvertisingDashboardSnapshots(
        toSnapshot(oldLoaded, []),
        toSnapshot(newLoaded, Array.from(unboundFacts.values())),
      ));
    }
    const output = {
      generated_at: new Date().toISOString(),
      status: comparisonExitCode(comparisons) === 0 ? "ready" : "blocked",
      dashboard_count: comparisons.length,
      mismatch_count: comparisons.reduce((sum, item) => sum + item.mismatches.length, 0),
      unbound_campaign_count: comparisons.reduce((sum, item) => sum + item.unbound_facts.length, 0),
      dashboards: comparisons,
    };
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    process.exitCode = comparisonExitCode(comparisons);
  } finally {
    if (previousFlag === undefined) delete process.env.AD_CANONICAL_READ_V2;
    else process.env.AD_CANONICAL_READ_V2 = previousFlag;
    await pool.end();
  }
}

const isEntrypoint = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;
if (isEntrypoint) {
  void main().catch((error) => {
    process.stderr.write(`Advertising read-model comparison failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
