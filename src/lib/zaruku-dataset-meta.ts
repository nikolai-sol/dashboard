import type {
  ZarukuDatasetMeta,
  ZarukuGeographyScope,
  ZarukuMetricAvailability,
  ZarukuSeoSourceId,
} from "@/lib/types";

type Period = { from: string; to: string };

type Input = {
  rowCount: number;
  sourceAvailable: boolean;
  fallbackVisible: boolean;
  sources: ZarukuSeoSourceId[];
  requestedPeriod: Period;
  actualTo: string | null;
  geography: ZarukuGeographyScope;
  metrics: ZarukuMetricAvailability;
  unavailableMessage?: string;
  fallbackMessage?: string;
};

export function makeZarukuDatasetMeta(input: Input): ZarukuDatasetMeta {
  const period = {
    from: input.requestedPeriod.from,
    to: input.actualTo && input.actualTo < input.requestedPeriod.to ? input.actualTo : input.requestedPeriod.to,
  };
  const state = input.fallbackVisible
    ? "partial"
    : !input.sourceAvailable
      ? "unavailable"
      : input.rowCount === 0
        ? "empty"
        : "ready";
  const message = state === "unavailable"
    ? (input.unavailableMessage ?? "Источник недоступен.")
    : state === "partial"
      ? (input.fallbackMessage ?? "Показаны доступные данные с ограничениями.")
      : null;

  return {
    state,
    sources: input.sources,
    period,
    requested_period: input.requestedPeriod,
    geography: input.geography,
    metrics: input.metrics,
    message,
  };
}
