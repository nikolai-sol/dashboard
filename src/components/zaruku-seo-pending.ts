import type { ZarukuSeoData } from "@/lib/types";

type PendingSourceInput = Pick<ZarukuSeoData, "pending_requirements" | "sources">;

export function formatPendingRequirementSources(data: PendingSourceInput) {
  const labels = data.pending_requirements.map((requirement) => {
    return data.sources.find((source) => source.id === requirement.source)?.label ?? requirement.title;
  });

  return labels.length > 0 ? labels.join(" · ") : "Все источники подключены";
}
