import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveRussiaCityCoordinates,
  selectRussiaDemandCities,
} from "./zaruku-russia-map-data";
import type { ZarukuSeoMetricRow } from "@/lib/types";

function metric(label: string, visits: number): ZarukuSeoMetricRow {
  return {
    label,
    visits,
    users: visits,
    pageviews: visits,
    share: visits,
    source: "metrika",
    layer: "onsite",
  };
}

test("resolves Metrika English and Russian city labels to longitude and latitude", () => {
  assert.deepEqual(resolveRussiaCityCoordinates("Moscow"), [37.6173, 55.7558]);
  assert.deepEqual(resolveRussiaCityCoordinates("Санкт-Петербург"), [30.3351, 59.9343]);
  assert.deepEqual(resolveRussiaCityCoordinates("Rostov-na-Donu"), [39.7015, 47.2357]);
});

test("does not invent positions for non-Russian or unknown city names", () => {
  assert.equal(resolveRussiaCityCoordinates("Singapore"), null);
  assert.equal(resolveRussiaCityCoordinates("Minsk"), null);
  assert.equal(resolveRussiaCityCoordinates("Unknown settlement"), null);
});

test("selects resolved cities by demand and leaves permanent labels on top five only", () => {
  const selected = selectRussiaDemandCities([
    metric("Sochi", 4),
    metric("Moscow", 43),
    metric("Singapore", 20),
    metric("Saint Petersburg", 14),
    metric("Rostov-na-Donu", 11),
    metric("Nizhny Novgorod", 8),
    metric("Perm", 7),
    metric("Yekaterinburg", 6),
  ]);

  assert.deepEqual(selected.map((city) => city.row.label), [
    "Moscow",
    "Saint Petersburg",
    "Rostov-na-Donu",
    "Nizhny Novgorod",
    "Perm",
    "Yekaterinburg",
    "Sochi",
  ]);
  assert.deepEqual(selected.map((city) => city.showLabel), [true, true, true, true, true, false, false]);
  assert.equal(selected.some((city) => city.row.label === "Singapore"), false);
});
