import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import type { RegionalRow, RegionalSourcePage } from './lyzobact-regions-types';

export interface RegionalImport {
  snapshotId: string; label: string; checkedAt: string; inputSha256: string;
  registerSha256: string; sourcesSha256: string; rows: RegionalRow[]; sourcePages: RegionalSourcePage[];
}
export interface RegionalImportConnection {
  beginTransaction(): Promise<unknown>; commit(): Promise<unknown>; rollback(): Promise<unknown>;
  execute(sql: string, params?: readonly unknown[]): Promise<readonly [unknown, unknown]>;
}
function hash(text: string) { return createHash('sha256').update(text).digest('hex'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected object');
  return value as Record<string, unknown>;
}
function text(value: unknown, required = false): string {
  if (value != null && typeof value !== 'string') throw new Error('Expected text');
  const result = value == null ? '' : value as string;
  if (required && !result.trim()) throw new Error('Required text missing');
  return result;
}
function date(value: unknown, required = false): string | null {
  const s = text(value, required); if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10) !== s) throw new Error(`Invalid date: ${s}`);
  return s;
}
function metric(value: unknown, count = false): number | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || (count && (value < 0 || !Number.isSafeInteger(value)))) throw new Error('Invalid numeric metric');
  return value;
}
function url(value: unknown): string | null {
  const s = text(value); if (!s) return null;
  const parsed = new URL(s);
  if (!['http:','https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Only public HTTP(S) source URLs allowed');
  return s; // Keep original Unicode and exact source spelling.
}
export function prepareRegionalImport(registerJson: string, sourcesCsv: string, options: {snapshotId: string; label: string; expectedRegions?: number; expectedSources?: number}): RegionalImport {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(options.snapshotId)) throw new Error('Invalid snapshot ID');
  const label = text(options.label,true);
  if (label.length > 255) throw new Error('Snapshot label too long');
  const input: unknown = JSON.parse(registerJson);
  if (!Array.isArray(input) || input.length !== (options.expectedRegions ?? 85)) throw new Error('Unexpected region count');
  const rows = input.map((value): RegionalRow => {
    const r = record(value), sourceQuality = text(r.access_content,true);
    if(!['Да','Нет'].includes(String(r.autumn)))throw new Error('Invalid autumn audit flag');
    // The frozen workbook's flag predates its 17 secondary autumn additions.
    const isAutumn2026 = r.autumn === 'Да' || text(r.status).startsWith('Осень 2026: СМИ —');
    const isIndex = /только индекс/i.test(sourceQuality);
    const isHistorical = !isAutumn2026 && !isIndex;
    return {
      regionKey:text(r.region_key,true),name:text(r.region,true),period:text(r.period),publicationDate:date(r.publication_date),checkedAt:date(r.checked_date,true)!,
      cases:metric(r.cases,true),casesPrior:metric(r.cases_prior,true),reportedWowPct:metric(r.reported_wow_pct),calculatedWowPct:metric(r.calculated_wow_pct),comparisonBasis:text(r.comparison_basis),
      sourceUrl:url(r.primary_url),alternateSourceUrl:url(r.alternate_url),sourceQuality,
      sourceQualityKind:isIndex?'index_only':isHistorical?'historical':/вторичной/i.test(sourceQuality)?'secondary_autumn':/Первичный текст/.test(sourceQuality)?'primary_autumn':'unknown',
      isHistorical,isAutumn2026,geography:text(r.geography),organization:text(r.organization),notes:text(r.gap),available:text(r.available),status:text(r.status),cadence:text(r.cadence),format:text(r.format),restriction:text(r.restriction),
      campaignStatus:'unknown',campaignStatusAt:null,wordstatWowPct:null,temperatureC:null,
    };
  });
  const keys = new Set(rows.map(r=>r.regionKey));
  if(keys.size !== rows.length) throw new Error('Duplicate region keys');
  const parsed=Papa.parse<Record<string,string>>(sourcesCsv.replace(/^\uFEFF/,''),{header:true,skipEmptyLines:'greedy'});
  if(parsed.errors.length) throw new Error(`Invalid source CSV: ${parsed.errors[0].code}`);
  if(parsed.data.length !== (options.expectedSources ?? 230)) throw new Error('Unexpected source count');
  const sourcePages=parsed.data.map((r,i):RegionalSourcePage=>{
    if(!keys.has(r.region_key))throw new Error('Source refers to unknown region');
    const sha=text(r.sha);if(sha && !/^[a-f0-9]{64}$/i.test(sha))throw new Error('Invalid source hash');
    const http=r.http_status===''||r.http_status==='0'?null:Number(r.http_status);
    if(http!==null && (!Number.isInteger(http)||http<100||http>599))throw new Error('Invalid HTTP status');
    const remote=text(r.remote);if(remote && !['True','False','true','false'].includes(remote))throw new Error('Invalid archive flag');
    return {id:i+1,regionKey:r.region_key,regionName:text(r.region,true),stage:text(r.stage),period:text(r.period),publicationDate:date(r.publication_date),data:text(r.data),url:url(r.url),verification:text(r.verification),geography:text(r.geography),checkedAt:date(r.checked_date),restriction:text(r.restriction),evidenceRef:text(r.evidence)||null,rawSha256:sha||null,remoteArchive:remote?remote.toLowerCase()==='true':null,httpStatus:http,sourceHttpStatusRaw:r.http_status||null};
  });
  const registerSha256=hash(registerJson),sourcesSha256=hash(sourcesCsv);
  return {snapshotId:options.snapshotId,label,checkedAt:rows.map(r=>r.checkedAt).sort().at(-1)!,registerSha256,sourcesSha256,inputSha256:hash(JSON.stringify({registerSha256,sourcesSha256,label})),rows,sourcePages};
}
export async function persistRegionalImport(connection:RegionalImportConnection,dashboardId:number,input:RegionalImport):Promise<'inserted'|'already_exists'> {
  if(!Number.isSafeInteger(dashboardId)||dashboardId<=0)throw new Error('Invalid dashboard ID');
  await connection.beginTransaction();
  try {
    const [result]=await connection.execute('SELECT input_sha256, publication_status FROM lyzobact_regions_snapshots WHERE dashboard_id = ? AND id = ? FOR UPDATE',[dashboardId,input.snapshotId]);
    const existing=(result as {input_sha256:string;publication_status:string}[])[0];
    if(existing){
      if(existing.input_sha256!==input.inputSha256 || existing.publication_status!=='published')throw new Error('Snapshot ID is immutable; choose a new ID for changed content');
      await connection.commit();return 'already_exists';
    }
    await connection.execute("INSERT INTO lyzobact_regions_snapshots (dashboard_id,id,label,checked_at,input_sha256,register_sha256,sources_sha256,region_count,source_count,publication_status) VALUES (?,?,?,?,?,?,?,?,?,'staged')",[dashboardId,input.snapshotId,input.label,input.checkedAt,input.inputSha256,input.registerSha256,input.sourcesSha256,input.rows.length,input.sourcePages.length]);
    for(const row of input.rows)await connection.execute('INSERT INTO lyzobact_regions_observations (dashboard_id,snapshot_id,region_key,payload_json) VALUES (?,?,?,?)',[dashboardId,input.snapshotId,row.regionKey,JSON.stringify(row)]);
    for(const page of input.sourcePages)await connection.execute('INSERT INTO lyzobact_regions_source_pages (dashboard_id,snapshot_id,source_ordinal,region_key,payload_json) VALUES (?,?,?,?,?)',[dashboardId,input.snapshotId,page.id,page.regionKey,JSON.stringify(page)]);
    await connection.execute("UPDATE lyzobact_regions_snapshots SET publication_status = 'published', published_at = UTC_TIMESTAMP() WHERE dashboard_id = ? AND id = ?",[dashboardId,input.snapshotId]);
    await connection.commit();return 'inserted';
  } catch(error) { await connection.rollback();throw error; }
}
