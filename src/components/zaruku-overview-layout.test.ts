import assert from "node:assert/strict";
import test from "node:test";
import type { ZarukuSeoKpi } from "@/lib/types";
import type { NorthStarKpis } from "@/components/zaruku-north-star";
import {
  buildNorthStarStripItems,
  buildTrafficHealthRows,
} from "@/components/zaruku-overview-layout";

const northStarKpis: NorthStarKpis = {
  noise: {
    key: "noise",
    label: "Шум в показах",
    value: 63.74,
    baseline: 63.74,
    delta: 0,
    goal: "down",
    period: "28d: 2026-06-13 — 2026-07-10",
    tooltip: "Доля показов по чужим брендам лабораторий.",
    series: [],
  },
  medicalIntent: {
    key: "medicalIntent",
    label: "Медицинский интент в показах",
    value: 24.81,
    baseline: 24.81,
    delta: 0,
    goal: "up",
    period: "28d: 2026-06-13 — 2026-07-10",
    guardValue: 72.79,
    guardBaseline: 72.79,
    series: [],
  },
  aiVisibility: {
    key: "aiVisibility",
    label: "Видимость в Алисе AI",
    value: 44,
    baseline: 44,
    delta: 0,
    goal: "up",
    period: "2026-07",
    note: "SoV, Яндекс Вебмастер, ручной снимок, ежемесячно",
    provenance: "wm_alisa_manual",
    series: [],
  },
  approveRate: {
    key: "approveRate",
    label: "Approve rate",
    value: 66.66666666666666,
    baseline: 66.66666666666666,
    delta: 0,
    goal: "up",
    period: "2026-W29",
    series: [],
  },
};

const metrikaKpis: ZarukuSeoKpi[] = [
  { key: "visits", label: "Визиты", value: "8 336", source: "metrika", layer: "onsite" },
  { key: "users", label: "Пользователи", value: "8 150", source: "metrika", layer: "onsite" },
  { key: "pageviews", label: "Просмотры", value: "10 500", source: "metrika", layer: "onsite" },
  { key: "organic_share", label: "Доля organic", value: "41%", source: "metrika", layer: "onsite" },
  { key: "direct_share", label: "Доля direct", value: "33%", source: "metrika", layer: "onsite" },
  { key: "russia_share", label: "Россия", value: "70%", source: "metrika", layer: "onsite" },
  { key: "mobile_share", label: "Mobile", value: "82%", source: "metrika", layer: "onsite" },
  { key: "avg_duration", label: "Ср. время", value: "1:35", source: "metrika", layer: "onsite" },
  { key: "bounce", label: "Отказы", value: "17%", source: "metrika", layer: "onsite" },
  { key: "depth", label: "Глубина", value: "2,5", source: "metrika", layer: "onsite" },
];

test("north-star strip hides zero deltas and keeps details in tooltips", () => {
  const items = buildNorthStarStripItems(northStarKpis);

  assert.deepEqual(items.map((item) => [item.key, item.label, item.arrow, item.showDelta]), [
    ["noise", "Шум", "↓", false],
    ["medicalIntent", "Мед. интент", "↑", false],
    ["aiVisibility", "Алиса AI", "↑", false],
    ["approveRate", "Approve", "↑", false],
  ]);
  assert.match(items[1].tooltip, /guard clicks_share 72,8%/);
  assert.match(items[2].tooltip, /wm_alisa_manual/);
  assert.match(items[2].tooltip, /SoV/);
});

test("traffic health promotes five Metrika facts and keeps the rest secondary", () => {
  const rows = buildTrafficHealthRows(metrikaKpis);

  assert.deepEqual(rows.primary.map((item) => [item.key, item.label, item.value]), [
    ["visits", "Визиты", "8 336"],
    ["users", "Пользователи", "8 150"],
    ["organic_share", "Organic", "41%"],
    ["bounce", "Отказы", "17%"],
    ["avg_duration", "Время", "1:35"],
  ]);
  assert.deepEqual(rows.secondary.map((item) => item.key), ["pageviews", "direct_share", "russia_share", "mobile_share", "depth"]);
});
