import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAbbottReturnFrequency,
  type AbbottFrequencyVisit,
} from "@/lib/abbott-return-frequency";

const visit = (
  client: string | null,
  visitId: string,
  startedAt: string,
  startUrl: string,
  rawUserIds: string[] = [],
): AbbottFrequencyVisit => ({
  client_id_hash: client,
  raw_user_ids: rawUserIds,
  visit_id_hash: visitId,
  session_started_at: startedAt,
  start_url: startUrl,
});

test("groups identified visitors by selected-period visit count", () => {
  const visits = [
    visit("client-a", "a1", "2026-06-01T08:00:00Z", "/a", ["user-a"]),
    visit("client-b", "b2", "2026-06-02T08:00:00Z", "/b-return", ["user-b"]),
    visit("client-b", "b1", "2026-06-02T08:00:00Z", "/b-initial", ["user-b"]),
    visit("client-c", "c1", "2026-06-03T08:00:00Z", "/c", ["user-c1"]),
    visit("client-c", "c2", "2026-06-04T08:00:00Z", "https://abbott.example/gastro/?utm=x", ["user-c2"]),
    visit("client-c", "c3", "2026-06-05T08:00:00Z", "https://ABBOTT.example//gastro#part", ["user-c1"]),
    visit("client-d", "d1", "2026-06-06T08:00:00Z", "/d"),
    visit("client-d", "d2", "2026-06-07T08:00:00Z", "/unknown"),
    visit("client-d", "d3", "2026-06-08T08:00:00Z", "/unknown"),
    visit("client-d", "d4", "2026-06-09T08:00:00Z", "/unknown"),
    visit(null, "n1", "2026-06-10T08:00:00Z", "/anonymous"),
    visit(null, "n2", "2026-06-11T08:00:00Z", "/anonymous"),
  ];
  const directions = new Map<string, string | null>([
    ["user-a", "Гастроэнтерология"],
    ["user-b", "Кардиология"],
    ["user-c1", "Гастроэнтерология"],
    ["user-c2", "Кардиология"],
  ]);
  const pageDirections = new Map([
    ["/b-return", "Кардиология"],
    ["/gastro", "Гастроэнтерология"],
  ]);

  const result = buildAbbottReturnFrequency(
    visits,
    directions,
    (url) => {
      try {
        return pageDirections.get(new URL(url).pathname) ?? null;
      } catch {
        return pageDirections.get(url) ?? null;
      }
    },
  );

  assert.equal(result.available, true);
  assert.equal(result.period_local, true);
  assert.equal(result.identified_visitors, 4);
  assert.equal(result.unidentified_visits, 2);
  assert.deepEqual(result.groups, [
    { group_id: "one", label: "1 раз", visitors: 1, share: 25, visits: 1 },
    { group_id: "two_to_three", label: "2–3 раза", visitors: 2, share: 50, visits: 5 },
    { group_id: "four_plus", label: "4+ раза", visitors: 1, share: 25, visits: 4 },
  ]);

  assert.deepEqual(result.user_directions, [
    {
      direction: "Направление не определено",
      frequency_group: "four_plus",
      visitors: 1,
      repeat_visits: 3,
    },
    {
      direction: "Несколько направлений",
      frequency_group: "two_to_three",
      visitors: 1,
      repeat_visits: 2,
    },
    {
      direction: "Кардиология",
      frequency_group: "two_to_three",
      visitors: 1,
      repeat_visits: 1,
    },
  ]);

  assert.deepEqual(result.return_pages, [
    {
      url: "/unknown",
      direction: "Направление не определено",
      frequency_group: "four_plus",
      returning_visitors: 1,
      repeat_visits: 3,
    },
    {
      url: "https://abbott.example/gastro",
      direction: "Гастроэнтерология",
      frequency_group: "two_to_three",
      returning_visitors: 1,
      repeat_visits: 2,
    },
    {
      url: "/b-return",
      direction: "Кардиология",
      frequency_group: "two_to_three",
      returning_visitors: 1,
      repeat_visits: 1,
    },
  ]);
});

test("returns stable empty aggregates without dividing by zero", () => {
  assert.deepEqual(buildAbbottReturnFrequency([], new Map(), () => null), {
    available: true,
    period_local: true,
    identified_visitors: 0,
    unidentified_visits: 0,
    groups: [
      { group_id: "one", label: "1 раз", visitors: 0, share: 0, visits: 0 },
      { group_id: "two_to_three", label: "2–3 раза", visitors: 0, share: 0, visits: 0 },
      { group_id: "four_plus", label: "4+ раза", visitors: 0, share: 0, visits: 0 },
    ],
    user_directions: [],
    return_pages: [],
  });
});

test("resolves a raw root start URL by its root path while retaining the root display URL", () => {
  const result = buildAbbottReturnFrequency([
    visit("client", "one", "2026-06-01T08:00:00Z", "/"),
    visit("client", "two", "2026-06-02T08:00:00Z", "/"),
  ], new Map(), (path) => path === "/" ? "Кардиология" : null);
  assert.equal(result.return_pages[0]?.url, "/");
  assert.equal(result.return_pages[0]?.direction, "Кардиология");
});
