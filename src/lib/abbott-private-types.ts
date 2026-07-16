export const ABBOTT_DATASET_KEY = "abbott" as const;

export const ABBOTT_PRIVATE_SOURCE_KINDS = {
  workbookJson: "abbott_workbook_json",
  workbookCatalog: "abbott_workbook_catalog",
  bitrixPages: "abbott_bitrix_pages",
  bitrixJourneys: "abbott_bitrix_journeys",
} as const;

export type AbbottPrivateSourceKind =
  (typeof ABBOTT_PRIVATE_SOURCE_KINDS)[keyof typeof ABBOTT_PRIVATE_SOURCE_KINDS];

export type AbbottPrivateSourceStatus = "test_dump" | "missing";

export interface AbbottPrivateSnapshotMetadata {
  source_status: AbbottPrivateSourceStatus;
  test_dump: true;
  snapshot_id: number | null;
  generated_at: string | null;
  period_from: string | null;
  period_to: string | null;
}

export interface AbbottResolvedSnapshot {
  id: number;
  sourceKind: AbbottPrivateSourceKind;
  generatedAt: string | null;
  periodFrom: string | null;
  periodTo: string | null;
}

export interface AbbottActiveRelease {
  id: number;
  snapshots: {
    workbookJson: AbbottResolvedSnapshot;
    workbookCatalog: AbbottResolvedSnapshot;
    bitrixPages: AbbottResolvedSnapshot | null;
    bitrixJourneys: AbbottResolvedSnapshot | null;
  };
}

export interface AbbottContentMetadata {
  direction: string | null;
  material_type: string | null;
  access: string | null;
  is_active: boolean | null;
}

export interface AbbottAggregateWorkbookData {
  generalMaterials: Array<{ name: string; url: string }>;
  externalEvents: Array<{
    title: string;
    direction: string | null;
    registration_url: string;
    access: string | null;
  }>;
  contentByTitle: Map<string, AbbottContentMetadata>;
  contentByTitleAndType: Map<string, AbbottContentMetadata>;
  contentBySlug: Map<string, AbbottContentMetadata>;
  urlReturnDirections: Map<string, string | null>;
  ymUrlReturn: [];
}

export interface ParsedAbbottWorkbook extends AbbottAggregateWorkbookData {
  /** Manager-only linkage data. Raw keys are never coerced to numbers. */
  userDirections: Map<string, string | null>;
}

export interface AbbottBitrixPageFact {
  report_date: string;
  url: string;
  path: string;
  material_id: string | null;
  material_type_hint: string | null;
  pageviews: number;
  sessions: number;
  users: number;
  guests: number;
  logged_in_hits: number;
  anonymous_hits: number;
  logged_in_sessions: number;
  anonymous_sessions: number;
  entry_sessions: number;
  exit_sessions: number;
  avg_session_duration_seconds: number | null;
  top_utm_source: string | null;
  top_utm_medium: string | null;
  top_utm_campaign: string | null;
}

export interface AbbottBitrixSnapshotSummary {
  date_from: string;
  date_to: string;
  page_rows: number;
}

export interface ParsedBitrixAnalytics {
  source: AbbottPrivateSnapshotMetadata;
  summary: AbbottBitrixSnapshotSummary | null;
  rows: AbbottBitrixPageFact[];
}

export interface AbbottPrivateJourneyEvent {
  sequence: number;
  event_at: string | null;
  normalized_path: string;
  event_kind: string;
}

export interface AbbottPrivateSessionJourneyRow {
  /** Protected identifiers stay lossless text even when they contain only digits. */
  protected_visit_id: string;
  raw_user_id: string | null;
  report_date: string;
  events: AbbottPrivateJourneyEvent[];
}

export interface AbbottPrivateSessionJourneysData {
  source: AbbottPrivateSnapshotMetadata;
  rows: AbbottPrivateSessionJourneyRow[];
}

export interface AbbottAggregateJourneyTransition {
  report_date: string;
  from_path: string;
  to_path: string;
  transitions: number;
}

export interface AbbottAggregatePrivateData {
  workbook: AbbottAggregateWorkbookData;
  bitrixPages: ParsedBitrixAnalytics;
  journeyTransitions: {
    source: AbbottPrivateSnapshotMetadata;
    rows: AbbottAggregateJourneyTransition[];
  };
}
