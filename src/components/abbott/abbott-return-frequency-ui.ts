import type {
  AbbottBiReturnFrequency,
  AbbottVisitFrequencyGroupId,
} from "@/lib/types";

type AbbottFilterOption = { value: string; label: string };

export type AbbottReturnFrequencyFilters = {
  frequency_group?: string;
  user_direction?: string;
  page_direction?: string;
  page_url?: string;
};

const CARD_LABELS: Record<AbbottVisitFrequencyGroupId, string> = {
  one: "1 визит",
  two_to_three: "2–3 визита",
  four_plus: "4+ визита",
};

const GROUP_ORDER: AbbottVisitFrequencyGroupId[] = ["one", "two_to_three", "four_plus"];

function options(values: readonly string[]): AbbottFilterOption[] {
  return [...new Set(values)]
    .sort((left, right) => left.localeCompare(right, "ru"))
    .map((value) => ({ value, label: value }));
}

export function buildAbbottReturnFrequencyUi(
  frequency: AbbottBiReturnFrequency,
  filters: AbbottReturnFrequencyFilters,
) {
  if (!frequency.available) {
    return {
      available: false,
      identifiedVisitors: 0,
      unidentifiedVisits: 0,
      cards: [],
      chart: [],
      userDirections: [],
      returnPages: [],
      options: {
        frequency_group: [] as AbbottFilterOption[],
        user_direction: [] as AbbottFilterOption[],
        page_direction: [] as AbbottFilterOption[],
        page_url: [] as AbbottFilterOption[],
      },
    };
  }

  const availableGroups = new Set([
    ...frequency.user_directions.map((row) => row.frequency_group),
    ...frequency.return_pages.map((row) => row.frequency_group),
  ]);
  const groupOptions = GROUP_ORDER
    .filter((group) => group !== "one" && availableGroups.has(group))
    .map((group) => ({
      value: group,
      label: frequency.groups.find((row) => row.group_id === group)?.label ?? group,
    }));
  return {
    available: true,
    identifiedVisitors: frequency.identified_visitors,
    unidentifiedVisits: frequency.unidentified_visits,
    cards: frequency.groups.map((group) => ({
      ...group,
      label: CARD_LABELS[group.group_id],
    })),
    chart: frequency.groups.map((group) => ({
      group_id: group.group_id,
      label: group.label,
      visitors: group.visitors,
      share: group.share,
    })),
    userDirections: frequency.user_directions.filter((row) =>
      (!filters.frequency_group || row.frequency_group === filters.frequency_group)
      && (!filters.user_direction || row.direction === filters.user_direction),
    ),
    returnPages: frequency.return_pages.filter((row) =>
      (!filters.frequency_group || row.frequency_group === filters.frequency_group)
      && (!filters.page_direction || row.direction === filters.page_direction)
      && (!filters.page_url || row.url === filters.page_url),
    ),
    options: {
      frequency_group: groupOptions,
      user_direction: options(frequency.user_directions.map((row) => row.direction)),
      page_direction: options(frequency.return_pages.map((row) => row.direction)),
      page_url: options(frequency.return_pages.map((row) => row.url)),
    },
  };
}
