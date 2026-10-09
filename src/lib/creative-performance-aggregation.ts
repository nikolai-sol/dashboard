import { resolvePlatformIdFromSourceKey } from "./source-mapping";
import { normalizeCreativeMinimumImpressions, creativeFieldValue, type CreativeFieldId, type CreativeRow } from './creative-performance-contract';

const DIMENSIONS = new Set<CreativeFieldId>(['source_account', 'campaign_id', 'creative_id', 'name', 'size']);
export interface CreativeGroup extends CreativeRow {
    group_key: string;
    member_count: number;
    mixed_cost_basis: boolean;
}
export function creativeDimensions(fields: readonly CreativeFieldId[]): CreativeFieldId[] {
    return fields.filter(field => DIMENSIONS.has(field));
}
const sumComplete = (a: number | null, b: number | null): number | null => a !== null && b !== null ? a + b : null;

/** Input must already satisfy the selected period and source/channel filters. */
export function groupCreativeRows(rows: readonly CreativeRow[], fields: readonly CreativeFieldId[], minImpressions = 0): CreativeGroup[] {
    const dimensions = creativeDimensions(fields);
    const groups = new Map<string, {row: CreativeGroup; costBasis: string}>();
    for (const input of rows) {
        // Only displayed values determine grouping. Hidden IDs never prevent a merge.
        const key = JSON.stringify(dimensions.map(field => creativeFieldValue(input, field)));
        // Currency is not verified in this read model. Only one account's source units
        // provide a compatible existing basis; this guard never changes the group key.
        const costBasis = JSON.stringify([input.source_key, input.platform_account_id]);
        const existing = groups.get(key);
        if (!existing) {
            groups.set(key, {row: {...input, group_key: key, member_count: 1, mixed_cost_basis: false}, costBasis});
            continue;
        }
        const row = existing.row;
        row.member_count++;
        if (row.preview_urls || input.preview_urls) row.preview_urls = [...new Set([...(row.preview_urls ?? []), ...(input.preview_urls ?? [])])];
        row.impressions = sumComplete(row.impressions, input.impressions);
        row.clicks = sumComplete(row.clicks, input.clicks);
        row.mixed_cost_basis ||= existing.costBasis !== costBasis;
        row.spend = row.mixed_cost_basis ? null : sumComplete(row.spend, input.spend);
        // Creative Metrica is paused; do not invent additive analytics across groups.
        row.postclick = null;
    }
    const minimum = normalizeCreativeMinimumImpressions(minImpressions);
    return [...groups.values()].map(({row}) => ({...row,
        ctr: row.impressions !== null && row.impressions > 0 && row.clicks !== null ? 100 * row.clicks / row.impressions : null,
        cpc: row.clicks !== null && row.clicks > 0 && row.spend !== null ? row.spend / row.clicks : null,
    })).filter(row => minimum === 0 || (row.impressions !== null && row.impressions >= minimum));
}
export function searchCreativeGroups(rows: CreativeGroup[], fields: readonly CreativeFieldId[], search: string): CreativeGroup[] {
    const dimensions = creativeDimensions(fields);
    const query = search.trim().toLocaleLowerCase();
    if (!dimensions.length || !query) return rows;
    return rows.filter(row => dimensions.some(field => String(creativeFieldValue(row, field) ?? '').toLocaleLowerCase().includes(query)));
}

export function filterCreativeRows(rows: readonly CreativeRow[], visibleChannels: readonly string[], selectedPlatforms?: readonly string[]): CreativeRow[] {
    const channels = new Set(visibleChannels);
    const platforms = selectedPlatforms === undefined ? undefined : new Set(selectedPlatforms);
    return rows.filter(row => channels.has(row.channel) && (!platforms || platforms.has(resolvePlatformIdFromSourceKey(row.source_key))));
}
