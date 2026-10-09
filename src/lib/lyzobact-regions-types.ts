/** Audit snapshots are source checks, never synchronized epidemiological weeks. */
export type RegionalSourceQualityKind = 'primary_autumn' | 'secondary_autumn' | 'historical' | 'index_only' | 'unknown';
export interface RegionalRow {
  regionKey: string; name: string; period: string; publicationDate: string | null;
  checkedAt: string; cases: number | null; casesPrior: number | null;
  reportedWowPct: number | null; calculatedWowPct: number | null; comparisonBasis: string;
  sourceUrl: string | null; alternateSourceUrl: string | null; sourceQuality: string;
  sourceQualityKind: RegionalSourceQualityKind; isHistorical: boolean; isAutumn2026: boolean;
  geography: string; organization: string; notes: string; available: string;
  status: string; cadence: string; format: string; restriction: string;
  campaignStatus: 'active' | 'inactive' | 'unknown'; campaignStatusAt: string | null;
  wordstatWowPct: number | null; temperatureC: number | null;
  wordstat?: RegionalWordstat;
}
export interface RegionalWordstat {
  version: 1; status: 'complete' | 'unmapped';
  priorPeriod: string; currentPeriod: string;
  providerRegionId: number | null; providerGeography: string | null;
  mappingStatus: 'exact_or_spelling_alias' | 'accepted_city_proxy' | 'combined_provider_geography' | 'not_in_returned_tree';
  geographyNote: string; limitation: string;
  baskets: RegionalWordstatBasket[];
}
export interface RegionalWordstatBasket {
  key: 'flu' | 'symptoms' | 'medicines'; phrase: string;
  priorCount: number | null; currentCount: number | null; wowPct: number | null;
  zeroBaseline: boolean; daysReceived: number; httpStatus: number | null;
  retrievedAt: string | null; rawSha256: string | null;
}
export interface RegionalSourcePage {
  id: number; regionKey: string; regionName: string; stage: string; period: string;
  publicationDate: string | null; data: string; url: string | null; verification: string;
  geography: string; checkedAt: string | null; restriction: string;
  evidenceRef: string | null; rawSha256: string | null; remoteArchive: boolean | null;
  httpStatus: number | null; sourceHttpStatusRaw: string | null;
}
export interface RegionalSnapshot { id: string; label: string; checkedAt: string; }
export interface RegionalModuleData {
  dashboardId: number;
  status: 'ready' | 'not_imported' | 'snapshot_not_found' | 'unavailable';
  errorCode?: 'schema_missing' | 'read_failed';
  snapshots: RegionalSnapshot[]; selectedSnapshotId: string | null;
  rows: RegionalRow[]; sourcePages: RegionalSourcePage[];
}
