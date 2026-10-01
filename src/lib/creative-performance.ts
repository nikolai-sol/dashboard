import type { RowDataPacket } from 'mysql2/promise';
import pool from './db';
import { aggregateCreativePostclick } from './creative-postclick';
import { advertisingFactTable } from './canonical-adapter';
import { ADS_AUTHORITY_FACT_SCOPE } from './source-mapping';
import { creativeKey, creativeSize, validateMappings, creativeAnalyticsThrough, type CreativeMapping, type CreativePerformance, type CreativeRow } from './creative-performance-contract';
export async function loadCreativePerformance(dashboardId: number, from: string, to: string, mappings: CreativeMapping[] = [], channels?: string[], goalIds: string[] = [], options: {
    executor?: Pick<typeof pool, "execute">;
    counters?: string[];
    goalMode?: "all" | "selected";
    now?: Date;
} = {}): Promise<CreativePerformance> {
    const executor = options.executor ?? pool;
    const [bindings] = await executor.execute<RowDataPacket[]>('SELECT DISTINCT line_key, channel, source_key, platform_account_id, platform_campaign_id, effective_from, effective_to FROM media_plan_bindings WHERE dashboard_id=?', [dashboardId]);
    const rows: CreativeRow[] = [];
    const eligible = bindings.filter(b => !channels || channels.includes(String(b.channel)));
    // One query per configured source; EXISTS prevents duplicate bindings multiplying facts.
    for (const source of new Set(eligible.map(b => String(b.source_key)))) {
        const [facts] = await executor.execute<RowDataPacket[]>(`SELECT f.platform_account_id,f.platform_campaign_id,f.platform_creative_id,
   f.report_date,SUM(f.impressions) impressions,SUM(f.clicks) clicks,SUM(f.spend) spend,
   MAX(c.creative_name) creative_name,MAX(CAST(c.raw_payload AS CHAR)) raw_payload
   FROM ${advertisingFactTable(source, true)} f
   LEFT JOIN canonical_source_creatives c ON c.source_key=f.source_key AND c.platform_account_id=f.platform_account_id AND c.platform_creative_id=f.platform_creative_id
   WHERE f.source_key=? AND f.fact_scope=? AND f.report_date BETWEEN ? AND ?
    AND COALESCE(f.platform_creative_id,'') NOT IN ('','__campaign__')
    AND EXISTS (SELECT 1 FROM media_plan_bindings b WHERE b.dashboard_id=? AND b.source_key=f.source_key
     AND b.platform_account_id=f.platform_account_id AND b.platform_campaign_id=f.platform_campaign_id
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
                row = { ...target, channel: String(b.channel), name: source === 'hybrid' ? `${f.platform_creative_id} (creative group)` : String(f.creative_name ?? f.platform_creative_id), size: creativeSize(f.raw_payload), impressions: 0, clicks: 0, spend: 0, ctr: null, cpc: null, postclick: null, availability: 'No UTM mapping' };
                aggregate.set(key, row);
            }
            row.impressions += Number(f.impressions || 0);
            row.clicks += Number(f.clicks || 0);
            row.spend += Number(f.spend || 0);
        }
        rows.push(...aggregate.values());
    }
    for (const row of rows) {
        row.ctr = row.impressions ? 100 * row.clicks / row.impressions : null;
        row.cpc = row.clicks ? row.spend / row.clicks : null;
        if (mappings.some(m => creativeKey(m) === creativeKey(row)))
            row.availability = 'Creative analytics collection not yet verified';
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
