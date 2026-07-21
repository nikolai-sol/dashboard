import { loadSeoIntelligenceData } from "@/lib/zaruku-seo-intelligence";
import { loadSeoProcessData } from "@/lib/zaruku-seo-os";
import { loadGoogleSearchConsoleFacts } from "@/lib/zaruku-gsc";
import { loadYandexWebmasterFacts } from "@/lib/zaruku-yandex-webmaster";
import type {
  ZarukuGscData,
  ZarukuSeoIntelligenceData,
  ZarukuSeoOsData,
  ZarukuYandexWebmasterData,
} from "@/lib/types";

export type DateRange = {
  from: string;
  to: string;
};

export type AccountFactsReadModel = {
  accountId: string;
  dateRange: DateRange;
  webmaster: ZarukuYandexWebmasterData;
  gsc: ZarukuGscData;
};

export type SeoProcessReadModel = ZarukuSeoOsData;

export type SeoIntelligenceReadModel = ZarukuSeoIntelligenceData & {
  reserved_measurements: {
    available: false;
    source: "seo_measurements";
  };
};

function requireAccountId(accountId: string) {
  const normalized = accountId.trim();
  if (!normalized) {
    throw new Error("accountId is required");
  }
  return normalized;
}

export async function loadAccountFacts(
  accountId: string,
  dateRange: DateRange,
  options: { weeks?: string[] } = {},
): Promise<AccountFactsReadModel> {
  const normalizedAccountId = requireAccountId(accountId);
  const [webmaster, gsc] = await Promise.all([
    loadYandexWebmasterFacts(normalizedAccountId, options.weeks),
    loadGoogleSearchConsoleFacts([normalizedAccountId], options.weeks),
  ]);
  return {
    accountId: normalizedAccountId,
    dateRange,
    webmaster,
    gsc,
  };
}

export async function loadSeoProcess(accountId: string, _week: string | null = null): Promise<SeoProcessReadModel> {
  void _week;
  const normalizedAccountId = requireAccountId(accountId);
  return loadSeoProcessData(normalizedAccountId);
}

export async function loadSeoIntelligence(accountId: string, _period: string | null = null): Promise<SeoIntelligenceReadModel> {
  void _period;
  const normalizedAccountId = requireAccountId(accountId);
  const intelligence = await loadSeoIntelligenceData(normalizedAccountId);
  return {
    ...intelligence,
    reserved_measurements: {
      available: false,
      source: "seo_measurements",
    },
  };
}
