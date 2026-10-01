export const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export type UtmTuple = Record<(typeof UTM_FIELDS)[number], string>;
export interface CreativeTarget {
    source_key: string;
    platform_account_id: string;
    platform_campaign_id: string;
    platform_creative_id: string;
    line_key: string;
}
export interface CreativeMapping extends CreativeTarget {
    counter_id: string;
    tuples: UtmTuple[];
}
export interface CreativeRow extends CreativeTarget {
    channel: string;
    name: string;
    size: string;
    impressions: number;
    clicks: number;
    spend: number;
    ctr: number | null;
    cpc: number | null;
    postclick: {
        visits: number;
        users: number | null;
        pageviews: number;
        page_depth: number | null;
        goal_reaches: number;
        conversion_rate: number | null;
        bounce_rate: number | null;
        avg_visit_duration: number | null;
    } | null;
    availability: string;
}
export interface CreativePerformance {
    rows: CreativeRow[];
    has_mappings: boolean;
    analytics_through?: string;
}
export function creativeKey(t: CreativeTarget): string { return JSON.stringify([t.source_key, t.platform_account_id, t.platform_campaign_id, t.platform_creative_id, t.line_key]); }
export function tupleKey(t: UtmTuple): string { return JSON.stringify(UTM_FIELDS.map(k => t[k])); }
export function validateMappings(value: unknown, targets: CreativeTarget[], counters: string[]): CreativeMapping[] {
    if (!Array.isArray(value) || value.length > 2000)
        throw new Error('Mappings must be an array of at most 2000 entries');
    const valid = new Set(targets.map(creativeKey));
    const assigned = new Set<string>();
    const seen = new Set<string>();
    return value.map(raw => {
        const m = raw as CreativeMapping;
        if (!m || ['source_key', 'platform_account_id', 'platform_campaign_id', 'platform_creative_id', 'line_key'].some(k => typeof (m as unknown as Record<string, unknown>)[k] !== 'string' || !(m as unknown as Record<string, unknown>)[k]) || !valid.has(creativeKey(m)))
            throw new Error('Creative target is outside this dashboard');
        if (!counters.includes(m.counter_id))
            throw new Error('Metrica counter is outside this dashboard');
        if (!Array.isArray(m.tuples) || !m.tuples.length || m.tuples.length > 100)
            throw new Error('Provide 1–100 exact UTM tuples');
        const id = creativeKey(m);
        if (seen.has(id))
            throw new Error('Duplicate creative mapping');
        seen.add(id);
        const tuples = m.tuples.map(t => {
            if (!t || UTM_FIELDS.some(k => typeof t[k] !== 'string' || t[k].length > 1024))
                throw new Error('All five UTM fields must be explicit strings');
            const key = JSON.stringify([m.counter_id, tupleKey(t)]);
            if (assigned.has(key))
                throw new Error('This counter and UTM tuple is already assigned');
            assigned.add(key);
            return Object.fromEntries(UTM_FIELDS.map(k => [k, t[k]])) as UtmTuple;
        });
        return { source_key: m.source_key, platform_account_id: m.platform_account_id, platform_campaign_id: m.platform_campaign_id, platform_creative_id: m.platform_creative_id, line_key: m.line_key, counter_id: m.counter_id, tuples };
    });
}
export function creativeSize(payload: unknown): string {
    try {
        const p = typeof payload === 'string' ? JSON.parse(payload) : payload;
        const s = p?.creative_size;
        if (s?.version !== 1)
            return '—';
        if (s.status === 'mixed')
            return 'Mixed sizes';
        const v = s.variants?.[0];
        return s.status === 'single' && s.variants?.length === 1 && Number(v.width) > 0 && Number(v.height) > 0 && ['native', 'parsed'].includes(v.source) ? `${v.width} × ${v.height} (${v.source})` : '—';
    }
    catch {
        return '—';
    }
}
export function isMediaCreativeDashboard(type: string): boolean { return ['awareness', 'performance', 'overview', 'multibrand'].includes(type); }

/** The dedicated editor owns this namespace; a stale generic wizard cannot replace it. */
export function preserveCreativeMappingNamespace(config:Record<string,unknown>,existing:Record<string,unknown>):void {
 delete config.creative_utm_bindings;
 if(existing.creative_utm_bindings!==undefined)config.creative_utm_bindings=existing.creative_utm_bindings;
}

/** Matches the Media collector's UTC anchor and one-day collection floor. */
export function creativeAnalyticsThrough(requestedTo:string,now:Date=new Date()):string {
 const day=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
 day.setUTCDate(day.getUTCDate()-1);
 const complete=day.toISOString().slice(0,10);
 return requestedTo<complete?requestedTo:complete;
}
