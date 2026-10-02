import type { RowDataPacket } from 'mysql2/promise';
import pool from './db';
import { aggregateCreativePostclick } from './creative-postclick';
import { advertisingFactTable } from './canonical-adapter';
import { ADS_AUTHORITY_FACT_SCOPE } from './source-mapping';
import { creativeKey, creativeSize, validateMappings, creativeAnalyticsThrough, type CreativeMapping, type CreativePerformance, type CreativeRow } from './creative-performance-contract';

export function hybridCreativeFactTable(): string {
    // The event identifies the full-account native contract. Coverage and the
    // active publication prove acceptance, including an accepted empty day.
    const accepted = (alias: string) => `SELECT 1 FROM canonical_ad_publications p
      JOIN canonical_ad_coverage_daily coverage ON coverage.publication_id=p.id
       AND coverage.source_key=p.source_key COLLATE utf8mb4_unicode_ci
       AND coverage.platform_account_id=p.platform_account_id COLLATE utf8mb4_unicode_ci
       AND coverage.report_date=p.report_date AND coverage.ingestion_run_id=p.ingestion_run_id
      WHERE p.source_key=${alias}.source_key COLLATE utf8mb4_unicode_ci
       AND p.platform_account_id=${alias}.platform_account_id COLLATE utf8mb4_unicode_ci
       AND p.report_date=${alias}.report_date AND p.status='published' AND p.is_active=1
       AND coverage.coverage_state IN ('complete_with_data','complete_empty')
       AND EXISTS (SELECT 1 FROM canonical_collector_run_events e
        WHERE e.run_id=p.ingestion_run_id AND e.event_type='hybrid_native_creative_publication'
         AND JSON_UNQUOTE(JSON_EXTRACT(e.event_payload,'$.contract_version'))='1'
         AND JSON_UNQUOTE(JSON_EXTRACT(e.event_payload,'$.breakdown_scope'))='native_creative'
         AND JSON_UNQUOTE(JSON_EXTRACT(e.event_payload,'$.identity'))='account_banner_id'
         AND JSON_UNQUOTE(JSON_EXTRACT(e.event_payload,'$.fetch_kind'))='full_account_day')`;
    const columns = 'source_key,platform_account_id,platform_campaign_id,fact_scope,report_date,platform_creative_id,spend,impressions,clicks';
    return `(SELECT ${columns},1 native_creative FROM canonical_advertising_facts_current native
      WHERE native.source_key='hybrid' AND native.native_grain='creative'
       AND native.breakdown_scope='native_creative' AND EXISTS (${accepted('native')})
      UNION ALL
      SELECT ${columns},0 native_creative FROM canonical_fact_ads_daily legacy
      WHERE legacy.source_key='hybrid' AND NOT EXISTS (${accepted('legacy')}))`;
}

export async function loadCreativePerformance(dashboardId: number, from: string, to: string, mappings: CreativeMapping[] = [], lines?: { line_key: string; channel: string }[], goalIds: string[] = [], options: {
    executor?: Pick<typeof pool, "execute">;
    counters?: string[];
    goalMode?: "all" | "selected";
    now?: Date;
    platformOnly?: boolean;
} = {}): Promise<CreativePerformance> {
    const executor = options.executor ?? pool;
    const [bindings] = await executor.execute<RowDataPacket[]>('SELECT DISTINCT line_key, channel, source_key, platform_account_id, platform_campaign_id, effective_from, effective_to FROM media_plan_bindings WHERE dashboard_id=?', [dashboardId]);
    const rows: CreativeRow[] = [];
    const currentLines = new Map(lines?.map(line => [line.line_key || line.channel, line.channel]));
    const eligible = bindings
        .filter(b => !lines || currentLines.has(String(b.line_key || b.channel)))
        .map(b => ({...b, channel: currentLines.get(String(b.line_key || b.channel)) ?? b.channel} as RowDataPacket));
    // One query per configured source; EXISTS prevents duplicate bindings multiplying facts.
    for (const source of new Set(eligible.map(b => String(b.source_key)))) {
        const [facts] = await executor.execute<RowDataPacket[]>(`SELECT f.platform_account_id,f.platform_campaign_id,f.platform_creative_id,
   f.report_date,SUM(f.impressions) impressions,SUM(f.clicks) clicks,SUM(f.spend) spend,COUNT(*) fact_rows,COUNT(f.spend) spend_rows,COUNT(f.impressions) impressions_rows,COUNT(f.clicks) clicks_rows,
   MAX(c.creative_name) creative_name,MAX(CAST(c.raw_payload AS CHAR)) raw_payload,${source === 'hybrid' ? 'MAX(f.native_creative)' : '0'} native_creative
   FROM ${source === 'hybrid' ? hybridCreativeFactTable() : advertisingFactTable(source, true)} f
   LEFT JOIN canonical_source_creatives c ON c.source_key=f.source_key COLLATE utf8mb4_unicode_ci AND c.platform_account_id=f.platform_account_id COLLATE utf8mb4_unicode_ci AND c.platform_creative_id=f.platform_creative_id COLLATE utf8mb4_unicode_ci
   WHERE f.source_key=? AND f.fact_scope=? AND f.report_date BETWEEN ? AND ?
    AND COALESCE(f.platform_creative_id,'') NOT IN ('','__campaign__')
    AND EXISTS (SELECT 1 FROM media_plan_bindings b WHERE b.dashboard_id=? AND b.source_key=f.source_key COLLATE utf8mb4_unicode_ci
     AND b.platform_account_id=f.platform_account_id COLLATE utf8mb4_unicode_ci AND b.platform_campaign_id=f.platform_campaign_id COLLATE utf8mb4_unicode_ci
     AND f.report_date>=COALESCE(b.effective_from,?) AND f.report_date<=COALESCE(b.effective_to,?))
   GROUP BY f.platform_account_id,f.platform_campaign_id,f.platform_creative_id,f.report_date`, [source, ADS_AUTHORITY_FACT_SCOPE[source] ?? 'delivery_entity', from, to, dashboardId, from, to]);
        const aggregate = new Map<string, CreativeRow>();
        for (const f of facts) {
            const date = String(f.report_date).slice(0, 10);
            const owners = eligible.filter(b => b.source_key === source && String(b.platform_account_id) === String(f.platform_account_id) && String(b.platform_campaign_id) === String(f.platform_campaign_id) && date >= String(b.effective_from ?? from).slice(0, 10) && date <= String(b.effective_to ?? to).slice(0, 10));
            // Conflicting legacy bindings cannot safely assign one fact to multiple plan lines.
            const lines = new Set(owners.map(b => String(b.line_key)));
            if (lines.size !== 1)
                continue;
            const b = owners[0];
            const target = { source_key: source, platform_account_id: String(f.platform_account_id), platform_campaign_id: String(f.platform_campaign_id), platform_creative_id: String(f.platform_creative_id), line_key: String(b.line_key) };
            const key = creativeKey(target);
            let row = aggregate.get(key);
            if (!row) {
                row = { ...target, channel: String(b.channel), name: source === 'hybrid' && !Number(f.native_creative) ? `${f.platform_creative_id} (creative group)` : String(f.creative_name ?? f.platform_creative_id), size: creativeSize(f.raw_payload), impressions: 0, clicks: 0, spend: 0, ctr: null, cpc: null, postclick: null, availability: 'No UTM mapping' };
                aggregate.set(key, row);
            }
            // A partial SUM is not a complete numerator or denominator for CTR.
            for (const metric of ['impressions', 'clicks'] as const) {
                const complete = f[metric] != null && Number(f.fact_rows) > 0
                    && Number(f[`${metric}_rows`]) === Number(f.fact_rows) && Number.isFinite(Number(f[metric]));
                row[metric] = row[metric] !== null && complete ? row[metric] + Number(f[metric]) : null;
            }
            // SUM alone hides missing costs inside a daily group. Preserve that uncertainty.
            const completeCost = f.spend != null && Number(f.fact_rows) > 0
                && Number(f.spend_rows) === Number(f.fact_rows) && Number.isFinite(Number(f.spend));
            row.spend = row.spend !== null && completeCost ? row.spend + Number(f.spend) : null;
        }
        rows.push(...aggregate.values());
    }
    for (const row of rows) {
        row.ctr = row.impressions && row.clicks !== null ? 100 * row.clicks / row.impressions : null;
        row.cpc = row.clicks && row.spend !== null ? row.spend / row.clicks : null;
        if (mappings.some(m => creativeKey(m) === creativeKey(row)))
            row.availability = 'Creative analytics collection not yet verified';
    }
    // This release's dashboard entry point deliberately excludes creative Metrica work.
    if (options.platformOnly) {
        for (const row of rows) row.availability = 'Platform creative data';
        return { rows, has_mappings: false };
    }
    const candidates = mappings.filter(m => rows.some(r => creativeKey(r) === creativeKey(m)));
    let validMappings: CreativeMapping[] = [];
    try {
        validMappings = validateMappings(mappings, mappings, options.counters ?? []).filter(m => rows.some(r => creativeKey(r) === creativeKey(m)));
    }
    catch {
        for (const row of rows)
            if (candidates.some(m => creativeKey(m) === creativeKey(row)))
                row.availability = 'Mapping conflict or counter no longer configured';
    }
    const analyticsTo=creativeAnalyticsThrough(to,options.now);
    for (const counter of new Set(validMappings.map(m => m.counter_id))) {
        if(analyticsTo<from) { for(const row of rows)if(validMappings.some(m=>creativeKey(m)===creativeKey(row)))row.availability="No completed Metrica days in this period"; continue; }
        try {
            const [facts] = await executor.execute<RowDataPacket[]>(`SELECT report_date,analytics_scope,attribution,utm_source,utm_medium,utm_campaign,utm_content,utm_term,visits,users,pageviews,bounce_rate,avg_visit_duration_seconds,goal_id,goal_reaches FROM canonical_fact_site_analytics_daily WHERE source_key='yandex_metrika' AND analytics_account_id=? AND analytics_scope IN ('creative_traffic','creative_goal') AND attribution='last' AND report_date BETWEEN ? AND ?`, [counter, from, analyticsTo]);
            const [coverage] = await executor.execute<RowDataPacket[]>(`SELECT report_date,analytics_scope,attribution,status FROM canonical_media_creative_coverage_daily WHERE source_key='yandex_metrika' AND analytics_account_id=? AND attribution='last' AND report_date BETWEEN ? AND ?`, [counter, from, analyticsTo]);
            for (const mapping of validMappings.filter(m => m.counter_id === counter)) {
                const row = rows.find(r => creativeKey(r) === creativeKey(mapping))!;
                if (validMappings.filter(m => creativeKey(m) === creativeKey(row)).length !== 1) {
                    row.availability = 'Multiple counters require separate attribution';
                    continue;
                }
                const owners = eligible.filter(b => b.source_key === row.source_key && String(b.platform_account_id) === row.platform_account_id && String(b.platform_campaign_id) === row.platform_campaign_id && String(b.line_key) === row.line_key);
                const dates: string[] = [];
                for (let d = from; d <= analyticsTo;) {
                    if (owners.some(b => d >= String(b.effective_from ?? from).slice(0, 10) && d <= String(b.effective_to ?? to).slice(0, 10)))
                        dates.push(d);
                    const day = new Date(d + 'T00:00:00Z');
                    day.setUTCDate(day.getUTCDate() + 1);
                    d = day.toISOString().slice(0, 10);
                }
                row.postclick = aggregateCreativePostclick(facts, coverage, mapping.tuples, dates, goalIds, options.goalMode);
                row.availability = row.postclick ? 'Exact UTM mapping · last attribution' : 'Accepted creative analytics coverage unavailable for part of this period';
            }
        }
        catch (error) {
            // Optional analytics failures must not hide independently verified advertising facts.
            for (const row of rows)
                if (validMappings.some(m => m.counter_id === counter && creativeKey(m) === creativeKey(row))) {
                    row.postclick = null;
                    row.availability = 'Creative analytics temporarily unavailable or not installed';
                }
            console.warn('Creative analytics unavailable', { dashboardId, counter, code: (error as {
                    code?: string;
                }).code ?? 'unknown' });
        }
    }
    return { rows, analytics_through:analyticsTo, has_mappings: rows.some(r => mappings.some(m => creativeKey(m) === creativeKey(r))) };
}
