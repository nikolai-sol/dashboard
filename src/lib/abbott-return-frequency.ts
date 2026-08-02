import { normalizeAbbottPagePath, normalizeAbbottPageUrl } from "@/lib/abbott-page-url";
import type {
  AbbottBiReturnFrequency,
  AbbottVisitFrequencyGroupId,
} from "@/lib/types";

export type AbbottFrequencyVisit = {
  client_id_hash: string | null;
  raw_user_ids: string[];
  visit_id_hash: string;
  session_started_at: string;
  start_url: string;
};

const GROUPS: Array<{
  group_id: AbbottVisitFrequencyGroupId;
  label: "1 раз" | "2–3 раза" | "4+ раза";
}> = [
  { group_id: "one", label: "1 раз" },
  { group_id: "two_to_three", label: "2–3 раза" },
  { group_id: "four_plus", label: "4+ раза" },
];

const UNKNOWN_DIRECTION = "Направление не определено";
const MULTIPLE_DIRECTIONS = "Несколько направлений";

function frequencyGroup(visitCount: number): AbbottVisitFrequencyGroupId {
  if (visitCount === 1) return "one";
  if (visitCount <= 3) return "two_to_three";
  return "four_plus";
}

function resolvedUserDirection(
  visits: readonly AbbottFrequencyVisit[],
  directionByUserId: ReadonlyMap<string, string | null>,
): string {
  const directions = new Set<string>();
  visits.forEach((visit) => {
    visit.raw_user_ids.forEach((userId) => {
      const direction = directionByUserId.get(userId)?.trim();
      if (direction) directions.add(direction);
    });
  });
  if (directions.size === 0) return UNKNOWN_DIRECTION;
  if (directions.size > 1) return MULTIPLE_DIRECTIONS;
  return [...directions][0];
}

export function buildAbbottReturnFrequency(
  visits: readonly AbbottFrequencyVisit[],
  directionByUserId: ReadonlyMap<string, string | null>,
  resolvePageDirection: (normalizedUrl: string) => string | null,
): AbbottBiReturnFrequency {
  const unidentifiedVisits = visits.filter((visit) => !visit.client_id_hash).length;
  const byClient = new Map<string, AbbottFrequencyVisit[]>();
  visits.forEach((visit) => {
    if (!visit.client_id_hash) return;
    const rows = byClient.get(visit.client_id_hash) ?? [];
    rows.push(visit);
    byClient.set(visit.client_id_hash, rows);
  });

  const groupTotals = new Map<AbbottVisitFrequencyGroupId, { visitors: number; visits: number }>(
    GROUPS.map((group) => [group.group_id, { visitors: 0, visits: 0 }]),
  );
  const directionTotals = new Map<
    string,
    { direction: string; group: "two_to_three" | "four_plus"; clients: Set<string>; repeatVisits: number }
  >();
  const pageTotals = new Map<
    string,
    {
      url: string;
      direction: string;
      group: "two_to_three" | "four_plus";
      clients: Set<string>;
      repeatVisits: number;
    }
  >();

  byClient.forEach((clientVisits, clientHash) => {
    clientVisits.sort((left, right) =>
      left.session_started_at.localeCompare(right.session_started_at)
      || left.visit_id_hash.localeCompare(right.visit_id_hash),
    );
    const group = frequencyGroup(clientVisits.length);
    const total = groupTotals.get(group);
    if (!total) throw new Error("Abbott return-frequency group is invalid");
    total.visitors += 1;
    total.visits += clientVisits.length;
    if (group === "one") return;

    const userDirection = resolvedUserDirection(clientVisits, directionByUserId);
    const directionKey = `${group}\n${userDirection}`;
    const directionRow = directionTotals.get(directionKey) ?? {
      direction: userDirection,
      group,
      clients: new Set<string>(),
      repeatVisits: 0,
    };
    directionRow.clients.add(clientHash);
    directionRow.repeatVisits += clientVisits.length - 1;
    directionTotals.set(directionKey, directionRow);

    clientVisits.slice(1).forEach((repeatVisit) => {
      const url = normalizeAbbottPageUrl(repeatVisit.start_url);
      const direction = resolvePageDirection(normalizeAbbottPagePath(url))?.trim() || UNKNOWN_DIRECTION;
      const pageKey = `${group}\n${direction}\n${url}`;
      const pageRow = pageTotals.get(pageKey) ?? {
        url,
        direction,
        group,
        clients: new Set<string>(),
        repeatVisits: 0,
      };
      pageRow.clients.add(clientHash);
      pageRow.repeatVisits += 1;
      pageTotals.set(pageKey, pageRow);
    });
  });

  const identifiedVisitors = byClient.size;
  return {
    available: true,
    period_local: true,
    identified_visitors: identifiedVisitors,
    unidentified_visits: unidentifiedVisits,
    groups: GROUPS.map((group) => {
      const total = groupTotals.get(group.group_id) ?? { visitors: 0, visits: 0 };
      return {
        ...group,
        visitors: total.visitors,
        share: identifiedVisitors > 0
          ? Number(((total.visitors / identifiedVisitors) * 100).toFixed(2))
          : 0,
        visits: total.visits,
      };
    }),
    user_directions: [...directionTotals.values()]
      .map((row) => ({
        direction: row.direction,
        frequency_group: row.group,
        visitors: row.clients.size,
        repeat_visits: row.repeatVisits,
      }))
      .sort((left, right) =>
        right.visitors - left.visitors
        || right.repeat_visits - left.repeat_visits
        || left.direction.localeCompare(right.direction, "ru"),
      ),
    return_pages: [...pageTotals.values()]
      .map((row) => ({
        url: row.url,
        direction: row.direction,
        frequency_group: row.group,
        returning_visitors: row.clients.size,
        repeat_visits: row.repeatVisits,
      }))
      .sort((left, right) =>
        right.returning_visitors - left.returning_visitors
        || right.repeat_visits - left.repeat_visits
        || left.url.localeCompare(right.url, "ru"),
      ),
  };
}
