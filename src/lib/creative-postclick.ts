import { tupleKey, UTM_FIELDS, type CreativeRow, type UtmTuple } from './creative-performance-contract';
type Fact = Record<string, unknown>;
export function aggregateCreativePostclick(facts: Fact[], coverage: Fact[], tuples: UtmTuple[], dates: string[], goalIds: string[], goalMode: "all" | "selected" = "all"): CreativeRow['postclick'] {
    const accepted = new Set(coverage.filter(c => c.attribution === 'last' && ['complete_with_data', 'complete_empty'].includes(String(c.status))).map(c => `${c.report_date}|${c.analytics_scope}`));
    if (!dates.length || dates.some(d => !accepted.has(`${d}|creative_traffic`) || !accepted.has(`${d}|creative_goal`)))
        return null;
    const wanted = new Set(tuples.map(tupleKey)), days = new Set(dates);
    const scoped = facts.filter(f => f.attribution === 'last' && days.has(String(f.report_date)));
    if (scoped.some(f => UTM_FIELDS.some(k => typeof f[k] !== 'string')))
        return null;
    const matched = scoped.filter(f => wanted.has(tupleKey(f as UtmTuple)));
    const traffic = matched.filter(f => f.analytics_scope === 'creative_traffic');
    const goals = matched.filter(f => f.analytics_scope === 'creative_goal' && (goalMode === 'all' || goalIds.includes(String(f.goal_id))));
    if (traffic.some(f => f.visits == null || f.pageviews == null) || goals.some(f => f.goal_reaches == null))
        return null;
    const sum = (key: string) => traffic.reduce((n, f) => n + Number(f[key] ?? 0), 0);
    const visits = sum('visits'), pageviews = sum('pageviews'), goal_reaches = goals.reduce((n, f) => n + Number(f.goal_reaches ?? 0), 0);
    const weighted = (key: string) => traffic.some(f => f[key] == null) ? null : visits ? traffic.reduce((n, f) => n + Number(f[key] ?? 0) * Number(f.visits ?? 0), 0) / visits : null;
    return { visits, users: traffic.length === 1 ? (traffic[0].users == null ? null : Number(traffic[0].users)) : traffic.length === 0 ? 0 : null, pageviews, page_depth: visits ? pageviews / visits : null, goal_reaches, conversion_rate: visits ? goal_reaches / visits * 100 : null, bounce_rate: weighted('bounce_rate'), avg_visit_duration: weighted('avg_visit_duration_seconds') };
}
