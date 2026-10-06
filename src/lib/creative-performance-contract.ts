// Creative Metrica configuration is deferred in the approved platform-only release.
export const CREATIVE_MAPPING_AVAILABLE = false;
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
    preview_urls?: string[];
    channel: string;
    name: string;
    size: string;
    impressions: number | null;
    clicks: number | null;
    spend: number | null;
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
    selected_columns?: CreativeFieldId[];
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
        return s.status === 'single' && s.variants?.length === 1 && Number(v.width) > 0 && Number(v.height) > 0 && ['native', 'parsed'].includes(v.source) ? `${v.width} × ${v.height}${v.source === 'native' ? ' (native)' : ''}` : '—';
    }
    catch {
        return '—';
    }
}
export function isMediaCreativeDashboard(type: string): boolean { return ['awareness', 'performance', 'overview', 'multibrand'].includes(type); }

/** The dedicated editor owns this namespace; a stale generic wizard cannot replace it. */
export function preserveCreativeMappingNamespace(config:Record<string,unknown>,existing:Record<string,unknown>):void {
 for(const key of ["creative_utm_bindings","creative_analytics","creative_preview_links"]) {
  delete config[key];
  if(existing[key]!==undefined)config[key]=existing[key];
 }
}

/** Matches the Media collector's UTC anchor and one-day collection floor. */
export function creativeAnalyticsThrough(requestedTo:string,now:Date=new Date()):string {
 const day=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
 day.setUTCDate(day.getUTCDate()-1);
 const complete=day.toISOString().slice(0,10);
 return requestedTo<complete?requestedTo:complete;
}

export const DEFAULT_CREATIVE_FIELDS = ['source_account', 'campaign_id', 'creative_id', 'name', 'size', 'impressions', 'clicks', 'spend', 'ctr', 'cpc'] as const;
export type CreativeFieldId = (typeof DEFAULT_CREATIVE_FIELDS)[number] | "preview";
export function creativeFields(value: unknown, showSpend: boolean): CreativeFieldId[] {
    const valid = new Set<string>(DEFAULT_CREATIVE_FIELDS);
    const fields = Array.isArray(value) ? [...new Set(value.filter((v): v is CreativeFieldId => typeof v === 'string' && valid.has(v)))] : [];
    return (fields.length ? fields : [...DEFAULT_CREATIVE_FIELDS]).filter(f => showSpend || !['spend', 'cpc'].includes(f));
}
export function creativeFieldLabel(field: CreativeFieldId, ru = false): string {
    if (field === "preview") return ru ? "Превью" : "Preview";
    const labels = ru ? ['Источник / кабинет', 'Кампания', 'ID креатива', 'Креатив', 'Размер', 'Показы', 'Клики', 'Расход платформы', 'CTR %', 'CPC'] : ['Source / account', 'Campaign', 'Creative ID', 'Creative name', 'Size', 'Impressions', 'Clicks', 'Platform spend', 'CTR %', 'CPC'];
    return labels[DEFAULT_CREATIVE_FIELDS.indexOf(field as (typeof DEFAULT_CREATIVE_FIELDS)[number])];
}
export function creativeFieldValue(row: CreativeRow, field: CreativeFieldId): string | number | null {
    if (field === 'preview') return row.preview_urls?.join('\n') ?? '';
    if (field === 'source_account') return `${row.source_key} / ${row.platform_account_id}`;
    if (field === 'campaign_id') return row.platform_campaign_id;
    if (field === 'creative_id') return row.platform_creative_id;
    if (field === 'ctr') return row.impressions !== null && row.impressions > 0 && row.clicks !== null ? 100 * row.clicks / row.impressions : null;
    return row[field];
}
/** Preserve the existing workbook's separate Source/Account columns by default. */
export function creativeExcelColumns(value: unknown, showSpend: boolean) {
    return creativeFields(value, showSpend).flatMap(field => field === 'source_account'
        ? [{label: 'Source', value: (row: CreativeRow): string | number | null => row.source_key}, {label: 'Account', value: (row: CreativeRow): string | number | null => row.platform_account_id}]
        : [{label: field === 'name' ? 'Creative' : creativeFieldLabel(field), value: (row: CreativeRow) => creativeFieldValue(row, field)}]);
}
