import assert from "node:assert/strict";
import test from "node:test";
import { makeZarukuDatasetMeta } from "./zaruku-dataset-meta";

const metrics = {
  visits: true,
  users: true,
  pageviews: true,
  bounce_rate: true,
  avg_duration_seconds: true,
  page_depth: true,
};

test("successful zero-row source is empty", () => {
  const meta = makeZarukuDatasetMeta({
    rowCount: 0,
    sourceAvailable: true,
    fallbackVisible: false,
    sources: ["metrika"],
    requestedPeriod: { from: "2026-06-24", to: "2026-07-21" },
    actualTo: "2026-07-21",
    geography: "russia",
    metrics,
  });
  assert.equal(meta.state, "empty");
  assert.equal(meta.message, null);
});

test("failed live source is unavailable without leaking its raw error", () => {
  const meta = makeZarukuDatasetMeta({
    rowCount: 0,
    sourceAvailable: false,
    fallbackVisible: false,
    sources: ["metrika"],
    requestedPeriod: { from: "2026-06-24", to: "2026-07-21" },
    actualTo: null,
    geography: "russia",
    metrics,
    unavailableMessage: "Срез Яндекс Метрики недоступен.",
  });
  assert.equal(meta.state, "unavailable");
  assert.equal(meta.message, "Срез Яндекс Метрики недоступен.");
});

test("visible fallback is partial and clips actual coverage", () => {
  const meta = makeZarukuDatasetMeta({
    rowCount: 12,
    sourceAvailable: false,
    fallbackVisible: true,
    sources: ["metrika"],
    requestedPeriod: { from: "2026-06-24", to: "2026-07-21" },
    actualTo: "2026-07-19",
    geography: "unsegmented",
    metrics,
    fallbackMessage: "Показаны canonical-данные без подтверждённого среза РФ.",
  });
  assert.equal(meta.state, "partial");
  assert.deepEqual(meta.period, { from: "2026-06-24", to: "2026-07-19" });
  assert.equal(meta.message, "Показаны canonical-данные без подтверждённого среза РФ.");
});

test("available canonical rows are partial when actual coverage ends early", () => {
  const meta = makeZarukuDatasetMeta({
    rowCount: 12,
    sourceAvailable: true,
    fallbackVisible: true,
    sources: ["metrika"],
    requestedPeriod: { from: "2026-06-24", to: "2026-07-21" },
    actualTo: "2026-07-19",
    geography: "unsegmented",
    metrics,
    fallbackMessage: "Данные доступны по 2026-07-19.",
  });
  assert.equal(meta.state, "partial");
  assert.equal(meta.message, "Данные доступны по 2026-07-19.");
});
