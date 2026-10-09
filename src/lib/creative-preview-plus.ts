import { creativeExcelColumns, DEFAULT_CREATIVE_FIELDS, type CreativeFieldId, type CreativeRow } from './creative-performance-contract';

export const DEFAULT_CREATIVE_PLUS_FIELDS: CreativeFieldId[] = ['name', 'size', 'impressions', 'clicks', 'ctr', 'preview'];
export const CREATIVE_PLUS_FIELDS: CreativeFieldId[] = [...DEFAULT_CREATIVE_FIELDS, 'preview'];
export function creativePlusFields(value: unknown, showSpend: boolean): CreativeFieldId[] {
    const fields = Array.isArray(value) ? [...new Set(value.filter((v): v is CreativeFieldId => typeof v === 'string' && CREATIVE_PLUS_FIELDS.includes(v as CreativeFieldId)))] : [];
    return (fields.length ? fields : [...DEFAULT_CREATIVE_PLUS_FIELDS]).filter(f => showSpend || !['spend', 'cpc'].includes(f));
}
export function safeCreativePreviewUrl(value: unknown): string | null {
    if (typeof value !== 'string' || value.length > 4096) return null;
    try {
        const url = new URL(value);
        const allowed = url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'preview.hybrid.ai' && !url.port);
        return allowed && !url.username && !url.password ? url.href : null;
    } catch { return null; }
}
const identity = (value: Record<string, unknown>) => JSON.stringify([value.source_key, value.platform_account_id, value.platform_creative_id]);
/** Links enrich only already-bound canonical rows; they never create platform facts. */
export function selectCreativePreviewRows(rows: readonly CreativeRow[], mappings: unknown): CreativeRow[] {
    if (Array.isArray(mappings) && mappings.length > 5000) return [];
    const configured = new Set<string>();
    const links = new Map<string, string>();
    const conflicts = new Set<string>();
    for (const value of Array.isArray(mappings) ? mappings : []) {
        if (!value || typeof value !== 'object') continue;
        const link = value as Record<string, unknown>;
        if (['source_key', 'platform_account_id', 'platform_creative_id'].some(k => typeof link[k] !== 'string' || !(link[k] as string).trim())) continue;
        const key = identity(link);
        configured.add(key);
        const url = safeCreativePreviewUrl(link.preview_url);
        if (!url) continue;
        if (links.has(key) && links.get(key) !== url) conflicts.add(key);
        links.set(key, url);
    }
    return rows.flatMap(row => {
        const key = identity(row as unknown as Record<string, unknown>);
        const url = configured.has(key) ? links.get(key) : safeCreativePreviewUrl(row.canonical_preview_url);
        return url && !conflicts.has(key) ? [{...row, preview_urls: [url], postclick: null}] : [];
    });
}

export function creativePlusExcelColumns(value: unknown, showSpend: boolean) {
    return creativePlusFields(value, showSpend).flatMap(field => field === 'preview'
        ? [{label: 'Preview', value: (row: CreativeRow): string | number | null => row.preview_urls?.join('\n') ?? ''}]
        : creativeExcelColumns([field], showSpend));
}
